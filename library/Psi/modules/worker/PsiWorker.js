"use strict";

if (typeof importScripts === "function") {
  try {
    importScripts("../../../_shared/utils/WorkerSanitisers.js");
  } catch (_error) {
    console.error(
      "Failed to load WorkerSanitisers.js, using built-in fallback sanitisers. This may cause issues if the main thread is relying on custom sanitisation logic.",
      _error,
    );
  }

  try {
    importScripts("../math/QMath.js");
  } catch (_error) {
    console.error("Failed to load QMath.js.", _error);
  }
}

const _workerSanitisers =
  globalThis.WorkerSanitisers ||
  Object.freeze({
    toFiniteNumber(value, fallback = 0) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    },
    toInteger(value, fallback, min, max) {
      const numeric = Math.round(this.toFiniteNumber(value, fallback));
      return numeric < min ? min : numeric > max ? max : numeric;
    },
  });

function _toWorkerErrorPayload(stage, error) {
  if (error && typeof error === "object") {
    return {
      type: "workerError",
      stage,
      name: String(error.name || "Error"),
      message: String(error.message || "Worker failure"),
      stack: String(error.stack || ""),
    };
  }

  return {
    type: "workerError",
    stage,
    name: "Error",
    message: String(error || "Worker failure"),
    stack: "",
  };
}

function _reportWorkerError(stage, error) {
  const payload = _toWorkerErrorPayload(stage, error);
  try {
    self.postMessage(payload);
  } catch {
    console.warn(
      "[PsiWorker] Failed to post error message to main thread. Original error:",
      payload,
    );
  }
  try {
    console.error(`[PsiWorker] ${payload.stage}: ${payload.message}`);
  } catch (_) {}
}

self.onerror = function (_message, _source, _lineno, _colno, error) {
  _reportWorkerError("runtime", error || _message);
  return false;
};

self.onunhandledrejection = function (event) {
  _reportWorkerError("unhandledrejection", event?.reason);
};

const CONSTS = {
  electronMassKg: 9.1093837015e-31,
  protonMassKg: 1.67262192369e-27,
  bohrRadiusM: 5.29177210903e-11,
};

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

const toFiniteNumber = _workerSanitisers.toFiniteNumber;
const toInteger = _workerSanitisers.toInteger;

const { logGamma, genLaguerre, assocLegendre } = globalThis.QMath || {};

if (!logGamma || !genLaguerre || !assocLegendre) {
  console.error("[PsiWorker] QMath failed to load. Wavefunction evaluation will not work.");
}

function sanitiseRenderPayload(data) {
  const n = toInteger(data.n, 1, 1, 12);
  const l = toInteger(data.l, 0, 0, n - 1);
  const m = toInteger(data.m, 0, -l, l);
  const res = toInteger(data.res, 256, 64, 512);

  const viewRadius = clamp(toFiniteNumber(data.viewRadius, 45), 1, 256);
  const slicePlane = ["xy", "xz", "yz"].includes(data.slicePlane)
    ? data.slicePlane
    : "xz";
  const sliceOffset = clamp(
    toFiniteNumber(data.sliceOffset, 0),
    -viewRadius,
    viewRadius,
  );

  const viewCentreRaw =
    data.viewCentre && typeof data.viewCentre === "object"
      ? data.viewCentre
      : {};
  const viewCentre = {
    x: clamp(toFiniteNumber(viewCentreRaw.x, 0), -1024, 1024),
    y: clamp(toFiniteNumber(viewCentreRaw.y, 0), -1024, 1024),
    z: clamp(toFiniteNumber(viewCentreRaw.z, 0), -1024, 1024),
  };

  const nuclearCharge = toInteger(data.nuclearCharge, 1, 1, 20);
  const useReducedMass = data.useReducedMass !== false;
  const fallbackMass =
    nuclearCharge === 1
      ? CONSTS.protonMassKg
      : Math.max(CONSTS.protonMassKg, nuclearCharge * CONSTS.protonMassKg);
  const nucleusMassKg = clamp(
    toFiniteNumber(data.nucleusMassKg, fallbackMass),
    1e-33,
    1e-20,
  );

  return {
    requestId: toInteger(data.requestId, 0, 0, 0x7fffffff),
    n,
    l,
    m,
    res,
    viewRadius,
    slicePlane,
    sliceOffset,
    viewCentre,
    nuclearCharge,
    useReducedMass,
    nucleusMassKg,
    includeAnalysis: Boolean(data.includeAnalysis),
    analysisSignature:
      typeof data.analysisSignature === "string"
        ? data.analysisSignature.slice(0, 256)
        : "",
    analysisResolution: toInteger(data.analysisResolution, 384, 64, 512),
    analysisViewRadius: clamp(
      toFiniteNumber(data.analysisViewRadius, viewRadius),
      1,
      512,
    ),
    reuseGridBuffer:
      data.reuseGridBuffer instanceof ArrayBuffer ? data.reuseGridBuffer : null,
  };
}

function reducedElectronNucleusMass(Z, nucleusMassKg) {
  const M = nucleusMassKg || (Z === 1 ? CONSTS.protonMassKg : 0);
  if (!M || M <= 0) {
    throw new Error("[Psi] nucleusMassKg is required for Z > 1");
  }
  const me = CONSTS.electronMassKg;
  return (me * M) / (me + M);
}

function reducedBohrRadius(muKg) {
  return CONSTS.bohrRadiusM * (CONSTS.electronMassKg / muKg);
}

let _cache = {
  key: "",
  logNormR: 0.0,
  l: 0,
  absM: 0,
  aMu: CONSTS.bohrRadiusM,
};

function _updateCache(n, l, m, Z, useReducedMass, nucleusMassKg) {
  const key = `${n}|${l}|${m}|${Z}|${useReducedMass ? 1 : 0}|${Number(nucleusMassKg || 0).toPrecision(8)}`;
  if (_cache.key === key) return;
  const absM = Math.abs(m);

  const muKg = useReducedMass
    ? reducedElectronNucleusMass(Z, nucleusMassKg)
    : CONSTS.electronMassKg;
  const aMu = reducedBohrRadius(muKg);

  let logNormR = 1.5 * Math.log((2.0 * Z) / (n * aMu));
  logNormR +=
    0.5 * (logGamma(n - l) - (Math.log(2.0 * n) + logGamma(n + l + 1)));

  _cache = { key, logNormR, l, absM, aMu };
}

function getProbabilityDensity(
  x,
  y,
  z,
  n,
  l,
  m,
  Z,
  useReducedMass,
  nucleusMassKg,
) {
  _updateCache(n, l, m, Z, useReducedMass, nucleusMassKg);
  const { logNormR, absM, aMu } = _cache;

  const xM = x * aMu;
  const yM = y * aMu;
  const zM = z * aMu;

  const r = Math.sqrt(xM * xM + yM * yM + zM * zM);
  const cosTheta = r > 0 ? Math.min(1, Math.max(-1, zM / r)) : 1.0;
  const rho = (2.0 * Z * r) / (n * aMu);
  const phi = Math.atan2(yM, xM);

  const R_nl =
    Math.exp(logNormR) *
    Math.exp(-rho / 2.0) *
    Math.pow(rho, l) *
    genLaguerre(n - l - 1, 2 * l + 1, rho);

  const p_lm = assocLegendre(l, absM, cosTheta);
  const logNormY =
    0.5 * Math.log((2 * l + 1) / (4 * Math.PI)) +
    0.5 * (logGamma(l - absM + 1) - logGamma(l + absM + 1));
  const normY = Math.exp(logNormY);

  const yRe = normY * p_lm * Math.cos(absM * phi);
  const yIm = normY * p_lm * Math.sin(absM * phi);

  const psiRe = R_nl * yRe;
  const psiIm = R_nl * yIm;
  const density = psiRe * psiRe + psiIm * psiIm;
  return Number.isFinite(density) ? density : 0.0;
}

function getSliceAxes(slicePlane) {
  if (slicePlane === "xy") return { c1: 0, c2: 1, cFixed: 2 };
  if (slicePlane === "yz") return { c1: 1, c2: 2, cFixed: 0 };
  return { c1: 0, c2: 2, cFixed: 1 };
}

function computeRadialProbabilityMoments(
  n,
  l,
  nuclearCharge,
  useReducedMass,
  nucleusMassKg,
  viewRadius,
) {
  const nQ = Math.max(1, Math.round(Number(n) || 1));
  const lQ = Math.max(0, Math.min(nQ - 1, Math.round(Number(l) || 0)));
  const Z = Math.max(1, Math.round(Number(nuclearCharge) || 1));

  const muKg = useReducedMass
    ? reducedElectronNucleusMass(Z, nucleusMassKg)
    : CONSTS.electronMassKg;
  const aMu = reducedBohrRadius(muKg);
  const toA0 = aMu / CONSTS.bohrRadiusM;

  let logNormR = 1.5 * Math.log((2.0 * Z) / (nQ * aMu));
  logNormR +=
    0.5 * (logGamma(nQ - lQ) - (Math.log(2.0 * nQ) + logGamma(nQ + lQ + 1)));

  const expectedRadiusAMu = (3 * nQ * nQ - lQ * (lQ + 1)) / (2 * Z);
  const maxRadiusAMu = Math.max(
    4,
    Number(viewRadius) || 0,
    expectedRadiusAMu * 4,
  );
  const samples = 2048;
  const dr = maxRadiusAMu / samples;

  let weightSum = 0;
  let weightedR = 0;
  let weightedR2 = 0;
  let peakWeight = -1;
  let radialPeakAMu = 0;

  for (let i = 1; i <= samples; i++) {
    const rAMu = i * dr;
    const rho = (2.0 * Z * rAMu) / nQ;
    const radialComponent =
      Math.exp(logNormR) *
      Math.exp(-rho / 2.0) *
      Math.pow(rho, lQ) *
      genLaguerre(nQ - lQ - 1, 2 * lQ + 1, rho);

    if (!Number.isFinite(radialComponent)) continue;

    const pR = rAMu * rAMu * radialComponent * radialComponent;
    if (!Number.isFinite(pR) || pR <= 0) continue;

    weightSum += pR;
    weightedR += pR * rAMu;
    weightedR2 += pR * rAMu * rAMu;

    if (pR > peakWeight) {
      peakWeight = pR;
      radialPeakAMu = rAMu;
    }
  }

  if (weightSum <= 0) {
    return { radialPeak: 0, radialSpread: 0 };
  }

  const meanR = weightedR / weightSum;
  const varianceR = Math.max(0, weightedR2 / weightSum - meanR * meanR);

  return {
    radialPeak: radialPeakAMu * toA0,
    radialSpread: Math.sqrt(varianceR) * toA0,
  };
}

function estimateOrbitalNodeCount3D(orbitalParams) {
  const nRaw = Number(orbitalParams?.n);
  const lRaw = Number(orbitalParams?.l);
  const n = Number.isFinite(nRaw) ? Math.max(1, Math.round(nRaw)) : 0;
  if (n <= 0) return 0;

  const maxL = Math.max(0, n - 1);
  const l = Number.isFinite(lRaw)
    ? Math.max(0, Math.min(maxL, Math.round(lRaw)))
    : 0;

  const radialNodes = Math.max(0, n - l - 1);
  const angularNodes = l;
  return radialNodes + angularNodes;
}

function computeDensityStatistics(grid, resolution, viewRadius, orbitalParams) {
  if (!grid || grid.length === 0) {
    return {
      peakDensity: 0,
      mean: 0,
      stdDev: 0,
      entropy: 0,
      concentration: 0,
      radialPeak: 0,
      radialSpread: 0,
      nodeEstimate: 0,
    };
  }

  let sum = 0;
  let peak = 0;
  for (let i = 0; i < grid.length; i++) {
    const val = grid[i];
    sum += val;
    if (val > peak) peak = val;
  }

  const mean = sum / grid.length;
  let variance = 0;
  let concentration = 0;
  let entropy = 0;

  for (let i = 0; i < grid.length; i++) {
    const val = grid[i];
    const diff = val - mean;
    variance += diff * diff;

    if (sum > 0) {
      const p = val / sum;
      if (p > 1e-300) {
        entropy -= p * Math.log(p);
        concentration += p * p;
      }
    }
  }

  const stdDev = Math.sqrt(variance / grid.length);
  const nodeEstimate = estimateOrbitalNodeCount3D(orbitalParams);
  const radialStandard = computeRadialProbabilityMoments(
    orbitalParams?.n,
    orbitalParams?.l,
    orbitalParams?.nuclearCharge,
    orbitalParams?.useReducedMass,
    orbitalParams?.nucleusMassKg,
    viewRadius,
  );

  return {
    peakDensity: peak,
    mean,
    stdDev,
    entropy,
    concentration,
    radialPeak: radialStandard.radialPeak,
    radialSpread: radialStandard.radialSpread,
    nodeEstimate,
  };
}

function computeGrid(
  n,
  l,
  m,
  res,
  viewRadius,
  slicePlane,
  sliceOffset,
  viewCentre,
  nuclearCharge,
  useReducedMass,
  nucleusMassKg,
  reuseGridBuffer,
) {
  const requiredByteLength = res * res * Float32Array.BYTES_PER_ELEMENT;
  const grid =
    reuseGridBuffer && reuseGridBuffer.byteLength === requiredByteLength
      ? new Float32Array(reuseGridBuffer)
      : new Float32Array(res * res);
  const step = res === 1 ? 0 : (viewRadius * 2) / (res - 1);

  const { c1, c2, cFixed } = getSliceAxes(slicePlane);
  const centreX = viewCentre.x || 0;
  const centreY = viewCentre.y || 0;
  const centreZ = viewCentre.z || 0;

  const axisCentre1 = c1 === 0 ? centreX : c1 === 1 ? centreY : centreZ;
  const axisCentre2 = c2 === 0 ? centreX : c2 === 1 ? centreY : centreZ;
  const axisCentreFixed =
    cFixed === 0 ? centreX : cFixed === 1 ? centreY : centreZ;

  let peak = 1e-10;

  for (let v = 0; v < res; v++) {
    const p2 = -viewRadius + v * step + axisCentre2;
    const rowOffset = v * res;

    for (let u = 0; u < res; u++) {
      const p1 = -viewRadius + u * step + axisCentre1;

      let x = 0,
        y = 0,
        z = 0;
      if (c1 === 0) x = p1;
      else if (c1 === 1) y = p1;
      else z = p1;
      if (c2 === 0) x = p2;
      else if (c2 === 1) y = p2;
      else z = p2;
      const fixedCoord = sliceOffset + axisCentreFixed;
      if (cFixed === 0) x = fixedCoord;
      else if (cFixed === 1) y = fixedCoord;
      else z = fixedCoord;

      const density = getProbabilityDensity(
        x,
        y,
        z,
        n,
        l,
        m,
        nuclearCharge,
        useReducedMass,
        nucleusMassKg,
      );
      grid[rowOffset + u] = density;
      if (density > peak) peak = density;
    }
  }

  const muKg = useReducedMass
    ? reducedElectronNucleusMass(nuclearCharge, nucleusMassKg)
    : CONSTS.electronMassKg;
  const aMu = reducedBohrRadius(muKg);

  return { grid, peak, aMu };
}

self.onmessage = function (e) {
  try {
    const msg = e && e.data && typeof e.data === "object" ? e.data : {};
    const { type } = msg;

    if (type === "render") {
      const safe = sanitiseRenderPayload(msg);

      const { grid, peak } = computeGrid(
        safe.n,
        safe.l,
        safe.m,
        safe.res,
        safe.viewRadius,
        safe.slicePlane,
        safe.sliceOffset,
        safe.viewCentre,
        safe.nuclearCharge,
        safe.useReducedMass,
        safe.nucleusMassKg,
        safe.reuseGridBuffer,
      );

      let analysisStatistics = null;
      let analysisPeak = null;
      let analysisAMu = null;
      const canonicalResolution = safe.analysisResolution;
      const canonicalViewRadius = safe.analysisViewRadius;

      if (safe.includeAnalysis) {
        const canonical = computeGrid(
          safe.n,
          safe.l,
          safe.m,
          canonicalResolution,
          canonicalViewRadius,
          safe.slicePlane,
          safe.sliceOffset,
          { x: 0, y: 0, z: 0 },
          safe.nuclearCharge,
          safe.useReducedMass,
          safe.nucleusMassKg,
        );

        analysisPeak = canonical.peak;
        analysisAMu = canonical.aMu;
        analysisStatistics = computeDensityStatistics(
          canonical.grid,
          canonicalResolution,
          canonicalViewRadius,
          {
            n: safe.n,
            l: safe.l,
            nuclearCharge: safe.nuclearCharge,
            useReducedMass: safe.useReducedMass,
            nucleusMassKg: safe.nucleusMassKg,
          },
        );
      }

      self.postMessage(
        {
          type: "result",
          requestId: safe.requestId,
          resolution: safe.res,
          grid: grid.buffer,
          peak,
          analysisPeak,
          analysisAMu,
          analysisResolution: canonicalResolution,
          analysisViewRadius: canonicalViewRadius,
          analysisSignature: safe.includeAnalysis ? safe.analysisSignature : "",
          analysisStatistics,
        },
        [grid.buffer],
      );
    }
  } catch (error) {
    _reportWorkerError("onmessage", error);
  }
};
