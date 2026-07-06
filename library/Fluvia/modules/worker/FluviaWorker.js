"use strict";

import { WorkerSanitisers } from "../../../_shared/utils/WorkerSanitisers.js";
import { installWorkerErrorReporter } from "../../../_shared/utils/WorkerErrorReporter.js";

const _workerSanitisers = WorkerSanitisers;

const _reportWorkerError = installWorkerErrorReporter(self, "FluviaWorker");

const SQRT2 = Math.SQRT2;
const HISTOGRAM_BINS = 256;
const neighbours = [
  { x: -1, y: -1, distance: SQRT2 },
  { x: -1, y: 0, distance: 1 },
  { x: -1, y: 1, distance: SQRT2 },
  { x: 0, y: -1, distance: 1 },
  { x: 0, y: 1, distance: 1 },
  { x: 1, y: -1, distance: SQRT2 },
  { x: 1, y: 0, distance: 1 },
  { x: 1, y: 1, distance: SQRT2 },
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function getIndex(size, x, y) {
  return y * size + x;
}

function getHeight(size, heightMap, x, y) {
  if (x < 0 || x >= size || y < 0 || y >= size) return 0;
  return heightMap[y * size + x];
}

function updateTotalHeight(heightMap, bedrockMap, sedimentMap, index) {
  heightMap[index] = bedrockMap[index] + sedimentMap[index];
}

function getSurfaceNormal(size, heightMap, heightScale, x, y) {
  const west = x > 0 ? y * size + (x - 1) : y * size + x;
  const east = x < size - 1 ? y * size + (x + 1) : y * size + x;
  const north = y > 0 ? (y - 1) * size + x : y * size + x;
  const south = y < size - 1 ? (y + 1) * size + x : y * size + x;

  const deltaX = (heightMap[west] - heightMap[east]) * heightScale;
  const deltaZ = (heightMap[north] - heightMap[south]) * heightScale;
  const deltaY = 1.0;
  const mag =
    Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) || 1;

  return {
    x: deltaX / mag,
    y: deltaY / mag,
    z: deltaZ / mag,
  };
}

function codyErf(x) {
  const absX = Math.abs(x);
  if (absX > 9.3) return x > 0 ? 1.0 : -1.0;

  let result;
  if (absX <= 0.84375) {
    const xSq = x * x;
    const p = [
      3.1611237438705656, 113.86415415105016, 377.485237685302,
      3209.3775891384695, 0.18577770618460315,
    ];
    const q = [
      23.601290953873412, 244.55303442692948, 1287.1751860847748,
      2844.2368334391706,
    ];

    const num = (((p[4] * xSq + p[0]) * xSq + p[1]) * xSq + p[2]) * xSq + p[3];
    const den = (((xSq + q[0]) * xSq + q[1]) * xSq + q[2]) * xSq + q[3];
    result = x * (num / den);
  } else if (absX <= 4.0) {
    const p = [
      0.5641884969886701, 8.883149794388376, 66.11542093743808,
      298.63513819740013, 881.9522212417691, 1712.0476126340706,
      2051.0783778260715, 1230.3393547979972, 2.1531153547440385e-8,
    ];
    const q = [
      15.744926110709835, 117.6939508913125, 537.1811018620099,
      1621.3895745386784, 3290.7992357334596, 4362.61909014206,
      3439.3676741437216, 1230.3393548037443,
    ];

    const n =
      (((((((p[8] * absX + p[0]) * absX + p[1]) * absX + p[2]) * absX + p[3]) *
        absX +
        p[4]) *
        absX +
        p[5]) *
        absX +
        p[6]) *
        absX +
      p[7];
    const d =
      (((((((absX + q[0]) * absX + q[1]) * absX + q[2]) * absX + q[3]) * absX +
        q[4]) *
        absX +
        q[5]) *
        absX +
        q[6]) *
        absX +
      q[7];

    result = 1.0 - Math.exp(-x * x) * (n / d);
    if (x < 0) result = -result;
  } else {
    result = x > 0 ? 1.0 : -1.0;
  }
  return result;
}

function getDischarge(dischargeMap, index) {
  return codyErf(0.4 * dischargeMap[index]);
}

const clamp = _workerSanitisers.clamp;
const toFiniteNumber = _workerSanitisers.toFiniteNumber;
const toInteger = _workerSanitisers.toInteger;

function coerceFloatMap(buffer, length) {
  if (!(buffer instanceof ArrayBuffer)) {
    return new Float32Array(length);
  }

  const incoming = new Float32Array(buffer);
  if (incoming.length === length) {
    return incoming;
  }

  const out = new Float32Array(length);
  out.set(incoming.subarray(0, Math.min(incoming.length, length)));
  return out;
}

function sanitiseStepPayload(data) {
  // 8-2048 here is a generic worker-side dimension safety bound (defence in
  // depth against a malformed/malicious message), not the user-facing
  // terrainSize range — that range lives in FLUVIA_SCHEMA (128-512, snapped to
  // one of AppCore.ALLOWED_TERRAIN_SIZES) and is enforced before a message is
  // ever sent. Do not "fix" this into matching the schema's range.
  const size = toInteger(data.size, 256, 8, 2048);
  const area = size * size;
  const params =
    data.params && typeof data.params === "object" ? data.params : {};

  return {
    requestId: toInteger(data.requestId, 0, 0, 0x7fffffff),
    size,
    area,
    randomSeed: toInteger(data.randomSeed, 1, 0, 0xffffffff),
    params: {
      dropletsPerFrame: toInteger(params.dropletsPerFrame, 256, 0, 4096),
      maxAge: toInteger(params.maxAge, 500, 1, 4096),
      minVolume: clamp(toFiniteNumber(params.minVolume, 0.01), 1e-6, 10),
      precipitationRate: clamp(
        toFiniteNumber(params.precipitationRate, 1),
        0,
        10,
      ),
      gravity: clamp(toFiniteNumber(params.gravity, 1), 0, 20),
      momentumTransfer: clamp(
        toFiniteNumber(params.momentumTransfer, 1),
        0,
        20,
      ),
      entrainment: clamp(toFiniteNumber(params.entrainment, 1), 0, 50),
      depositionRate: clamp(toFiniteNumber(params.depositionRate, 0.1), 0, 1),
      evaporationRate: clamp(
        toFiniteNumber(params.evaporationRate, 0.001),
        1e-6,
        1,
      ),
      sedimentErosionRate: clamp(
        toFiniteNumber(params.sedimentErosionRate, 0.1),
        0,
        1,
      ),
      bedrockErosionRate: clamp(
        toFiniteNumber(params.bedrockErosionRate, 0.1),
        0,
        1,
      ),
      maxHeightDiff: clamp(toFiniteNumber(params.maxHeightDiff, 0.01), 1e-5, 4),
      settlingRate: clamp(toFiniteNumber(params.settlingRate, 0.8), 0, 1),
      learningRate: clamp(toFiniteNumber(params.learningRate, 0.1), 0, 1),
      heightScale: clamp(toFiniteNumber(params.heightScale, 100), 1, 4096),
    },
  };
}

function thermalErosion(state, x, y) {
  const {
    size,
    heightMap,
    sedimentMap,
    bedrockMap,
    maxHeightDiff,
    settlingRate,
  } = state;

  const cx = x | 0;
  const cy = y | 0;
  if (cx < 0 || cx >= size || cy < 0 || cy >= size) return;

  const cIdx = getIndex(size, cx, cy);
  const cHeight = heightMap[cIdx];

  for (let i = 0; i < neighbours.length; i++) {
    const { x: nxOff, y: nyOff, distance } = neighbours[i];
    const nx = cx + nxOff;
    const ny = cy + nyOff;
    if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;

    const nIdx = getIndex(size, nx, ny);
    const nHeight = heightMap[nIdx];
    const diff = cHeight - nHeight;
    if (diff === 0) continue;

    const excess = Math.abs(diff) - distance * maxHeightDiff;
    if (excess <= 0) continue;

    const transfer = (settlingRate * excess) / 2;
    const srcIdx = diff > 0 ? cIdx : nIdx;
    const tgtIdx = diff > 0 ? nIdx : cIdx;

    heightMap[srcIdx] -= transfer;
    heightMap[tgtIdx] += transfer;

    let remaining = transfer;
    const fromSed = Math.min(remaining, sedimentMap[srcIdx]);
    sedimentMap[srcIdx] -= fromSed;
    remaining -= fromSed;

    if (remaining > 0) {
      bedrockMap[srcIdx] -= remaining;
    }
    sedimentMap[tgtIdx] += transfer;
  }
}

function updateDischargeMap(state) {
  const {
    area,
    learningRate,
    dischargeMap,
    dischargeTrack,
    momentumX,
    momentumXTrack,
    momentumY,
    momentumYTrack,
  } = state;
  const invLR = 1.0 - learningRate;
  for (let i = 0; i < area; i++) {
    dischargeMap[i] =
      invLR * dischargeMap[i] + learningRate * dischargeTrack[i];
    momentumX[i] = invLR * momentumX[i] + learningRate * momentumXTrack[i];
    momentumY[i] = invLR * momentumY[i] + learningRate * momentumYTrack[i];
  }
}

function hydraulicErosion(state) {
  const {
    dropletsPerFrame,
    maxAge,
    minVolume,
    precipitationRate,
    gravity,
    momentumTransfer,
    entrainment,
    depositionRate,
    evaporationRate,
    sedimentErosionRate,
    bedrockErosionRate,
    size,
    heightScale,
    heightMap,
    sedimentMap,
    bedrockMap,
    dischargeTrack,
    momentumXTrack,
    momentumYTrack,
    momentumX,
    momentumY,
    dischargeMap,
    randomSeed,
  } = state;

  const rand = mulberry32(randomSeed || 1);

  dischargeTrack.fill(0);
  momentumXTrack.fill(0);
  momentumYTrack.fill(0);

  for (let d = 0; d < dropletsPerFrame; d++) {
    let x = (rand() * size) | 0;
    let y = (rand() * size) | 0;

    if (getHeight(size, heightMap, x, y) < 0.1) continue;

    let vx = 0;
    let vy = 0;
    let sediment = 0;
    let age = 0;
    let volume = precipitationRate;

    while (age < maxAge && volume >= minVolume) {
      const floorX = x | 0;
      const floorY = y | 0;
      if (floorX < 0 || floorX >= size || floorY < 0 || floorY >= size) break;

      const index = getIndex(size, floorX, floorY);
      const heightStart = heightMap[index];
      const normal = getSurfaceNormal(
        size,
        heightMap,
        heightScale,
        floorX,
        floorY,
      );

      vx += (gravity * normal.x) / volume;
      vy += (gravity * normal.z) / volume;

      const pmX = momentumX[index];
      const pmY = momentumY[index];
      const pmMag = Math.sqrt(pmX * pmX + pmY * pmY);

      if (pmMag > 0) {
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed > 0) {
          const alignment = (pmX * vx + pmY * vy) / (pmMag * speed);
          const transfer =
            (momentumTransfer * alignment) / (volume + dischargeMap[index]);
          vx += transfer * pmX;
          vy += transfer * pmY;
        }
      }

      const finalSpeed = Math.sqrt(vx * vx + vy * vy);
      if (finalSpeed > 0) {
        const mag = Math.SQRT2 / finalSpeed;
        vx *= mag;
        vy *= mag;
      }

      x += vx;
      y += vy;

      dischargeTrack[index] += volume;
      momentumXTrack[index] += volume * vx;
      momentumYTrack[index] += volume * vy;

      const isOut = x < 0 || x >= size || y < 0 || y >= size;
      const heightEnd = isOut
        ? heightStart - 0.002
        : getHeight(size, heightMap, x | 0, y | 0);

      const transportCapacity = Math.max(
        0,
        (1 + entrainment * getDischarge(dischargeMap, index)) *
          (heightStart - heightEnd),
      );
      const deficit = transportCapacity - sediment;

      if (deficit > 0) {
        const fromSed = Math.min(
          sedimentMap[index],
          deficit * sedimentErosionRate,
        );
        sedimentMap[index] -= fromSed;

        let actualEroded = fromSed;
        const remainingDeficit = deficit - fromSed / sedimentErosionRate;

        if (remainingDeficit > 0) {
          const fromBed = remainingDeficit * bedrockErosionRate;
          bedrockMap[index] -= fromBed;
          actualEroded += fromBed;
        }
        sediment += actualEroded;
      } else {
        const dep = -deficit * depositionRate;
        sedimentMap[index] += dep;
        sediment -= dep;
      }

      updateTotalHeight(heightMap, bedrockMap, sedimentMap, index);

      const evap = 1 - evaporationRate;
      volume *= evap;
      sediment *= evap;

      if (isOut) break;

      thermalErosion(state, x, y);
      age++;
    }
  }
}

function calcCellSurfaceArea(x, y, size, heightMap, scale) {
  const i = y * size + x;
  const h00 = heightMap[i] * scale;
  const h10 = heightMap[i + 1] * scale;
  const h01 = heightMap[i + size] * scale;
  const h11 = heightMap[i + size + 1] * scale;
  const dx = (h10 - h00 + h11 - h01) * 0.5;
  const dy = (h01 - h00 + h11 - h10) * 0.5;
  return Math.sqrt(1 + dx * dx + dy * dy);
}

function normaliseHistogram(heightHistogram) {
  const normHistogram = new Float32Array(HISTOGRAM_BINS);
  let maxBin = 0;

  for (let i = 0; i < HISTOGRAM_BINS; i++) {
    if (heightHistogram[i] > maxBin) maxBin = heightHistogram[i];
  }

  if (maxBin > 0) {
    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      normHistogram[i] = heightHistogram[i] / maxBin;
    }
  }

  return normHistogram;
}

function computeAnalysis(state, analysisState) {
  const {
    area,
    size,
    heightScale,
    evaporationRate,
    heightMap,
    bedrockMap,
    sedimentMap,
    dischargeMap,
  } = state;

  let totalW = 0;
  let totalS = 0;
  let totalB = 0;
  let riverCells = 0;
  let totalSA = 0;
  let sumE = 0;
  let sumSqE = 0;
  let slopeSum = 0;
  let compWater = 0;
  let compSediment = 0;
  let compFlat = 0;
  let compSteep = 0;
  let compSlopeMean = 0;
  let compSedimentMean = 0;
  let compWaterMean = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let minSediment = Infinity;
  let maxSediment = -Infinity;
  let minDischarge = Infinity;
  let maxDischarge = -Infinity;

  const heightHistogram = new Int32Array(HISTOGRAM_BINS);

  const nowMs =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const deltaTime = Math.max(
    1e-6,
    (nowMs - (analysisState.lastAnalysisTimeMs || nowMs - 16)) / 1000,
  );

  for (let i = 0; i < area; i++) {
    const h = heightMap[i];
    const s = sedimentMap[i];
    const b = bedrockMap[i];
    const rawD = dischargeMap[i];
    const d = getDischarge(dischargeMap, i);

    totalW += rawD;
    totalS += s;
    totalB += b;
    sumE += h;
    sumSqE += h * h;

    if (d > 0.05) riverCells++;

    if (h < minHeight) minHeight = h;
    if (h > maxHeight) maxHeight = h;
    if (s < minSediment) minSediment = s;
    if (s > maxSediment) maxSediment = s;
    if (d < minDischarge) minDischarge = d;
    if (d > maxDischarge) maxDischarge = d;

    const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, (h * 255) | 0));
    heightHistogram[bin]++;

    const x = i % size;
    const y = (i / size) | 0;

    if (x < size - 1 && y < size - 1) {
      const surfaceArea = calcCellSurfaceArea(
        x,
        y,
        size,
        heightMap,
        heightScale,
      );
      totalSA += surfaceArea;
      slopeSum += surfaceArea - 1.0;
    }

    const normal = getSurfaceNormal(size, heightMap, heightScale, x, y);
    const slopeW = clamp(1 - normal.y, 0, 1);
    const sedW = clamp(s * 5, 0, 1);
    const waterW = clamp(d, 0, 1);

    const steepBase = slopeW;
    const flatBase = 1 - slopeW;

    compFlat += flatBase * (1 - sedW) * (1 - waterW);
    compSteep += steepBase * (1 - sedW) * (1 - waterW);
    compSediment += sedW * (1 - waterW);
    compWater += waterW;

    compSlopeMean += slopeW;
    compSedimentMean += sedW;
    compWaterMean += waterW;
  }

  const avgElevation = sumE / area;
  const variance = sumSqE / area - avgElevation * avgElevation;
  const invArea = 1 / area;
  const sedimentFlux =
    (totalS - (analysisState.prevTotalSediment || 0)) / deltaTime;
  const erosionRate =
    ((analysisState.prevTotalBedrock || 0) - totalB) / deltaTime;

  analysisState.prevTotalSediment = totalS;
  analysisState.prevTotalBedrock = totalB;
  analysisState.lastAnalysisTimeMs = nowMs;

  const normHistogram = normaliseHistogram(heightHistogram);

  return {
    heightHistogram,
    normHistogram,
    avgElevation,
    elevationStdDev: Math.sqrt(Math.max(0, variance)),
    heightBounds: {
      min: Number.isFinite(minHeight) ? minHeight : 0,
      max: Number.isFinite(maxHeight) ? maxHeight : 0,
    },
    totalWater: totalW,
    totalSediment: totalS,
    totalBedrock: totalB,
    sedimentBounds: {
      min: Number.isFinite(minSediment) ? minSediment : 0,
      max: Number.isFinite(maxSediment) ? maxSediment : 0,
    },
    activeWaterCover: riverCells,
    drainageDensity: (riverCells / area) * 100,
    dischargeBounds: {
      min: Number.isFinite(minDischarge) ? minDischarge : 0,
      max: Number.isFinite(maxDischarge) ? maxDischarge : 0,
    },
    hydraulicResidence: totalW / (evaporationRate * area + 1e-6),
    rugosity: totalSA / area,
    slopeComplexity: slopeSum / area,
    sedimentFlux,
    erosionRate,
    compositeWaterCoveragePct: compWater * invArea * 100,
    compositeSedimentCoveragePct: compSediment * invArea * 100,
    compositeFlatCoveragePct: compFlat * invArea * 100,
    compositeSteepCoveragePct: compSteep * invArea * 100,
    compositeMeanSlopeWeight: compSlopeMean * invArea,
    compositeMeanSedimentAlpha: compSedimentMean * invArea,
    compositeMeanWaterAlpha: compWaterMean * invArea,
  };
}

const analysisState = {
  prevTotalSediment: 0,
  prevTotalBedrock: 0,
  lastAnalysisTimeMs: 0,
};

self.onmessage = function (e) {
  try {
    const data = e && e.data && typeof e.data === "object" ? e.data : {};
    if (data.type !== "step") return;

    const safe = sanitiseStepPayload(data);

    const state = {
      size: safe.size,
      area: safe.area,
      randomSeed: safe.randomSeed,

      dropletsPerFrame: safe.params.dropletsPerFrame,
      maxAge: safe.params.maxAge,
      minVolume: safe.params.minVolume,
      precipitationRate: safe.params.precipitationRate,
      gravity: safe.params.gravity,
      momentumTransfer: safe.params.momentumTransfer,
      entrainment: safe.params.entrainment,
      depositionRate: safe.params.depositionRate,
      evaporationRate: safe.params.evaporationRate,
      sedimentErosionRate: safe.params.sedimentErosionRate,
      bedrockErosionRate: safe.params.bedrockErosionRate,
      maxHeightDiff: safe.params.maxHeightDiff,
      settlingRate: safe.params.settlingRate,
      learningRate: safe.params.learningRate,
      heightScale: safe.params.heightScale,

      heightMap: coerceFloatMap(data.heightMap, safe.area),
      bedrockMap: coerceFloatMap(data.bedrockMap, safe.area),
      sedimentMap: coerceFloatMap(data.sedimentMap, safe.area),
      dischargeMap: coerceFloatMap(data.dischargeMap, safe.area),
      dischargeTrack: coerceFloatMap(data.dischargeTrack, safe.area),
      momentumX: coerceFloatMap(data.momentumX, safe.area),
      momentumY: coerceFloatMap(data.momentumY, safe.area),
      momentumXTrack: coerceFloatMap(data.momentumXTrack, safe.area),
      momentumYTrack: coerceFloatMap(data.momentumYTrack, safe.area),
    };

    hydraulicErosion(state);
    updateDischargeMap(state);
    const analysis = computeAnalysis(state, analysisState);

    self.postMessage(
      {
        type: "result",
        requestId: safe.requestId,
        heightMap: state.heightMap.buffer,
        bedrockMap: state.bedrockMap.buffer,
        sedimentMap: state.sedimentMap.buffer,
        dischargeMap: state.dischargeMap.buffer,
        dischargeTrack: state.dischargeTrack.buffer,
        momentumX: state.momentumX.buffer,
        momentumY: state.momentumY.buffer,
        momentumXTrack: state.momentumXTrack.buffer,
        momentumYTrack: state.momentumYTrack.buffer,
        analysis: {
          ...analysis,
          heightHistogram: analysis.heightHistogram.buffer,
          normHistogram: analysis.normHistogram.buffer,
        },
      },
      [
        state.heightMap.buffer,
        state.bedrockMap.buffer,
        state.sedimentMap.buffer,
        state.dischargeMap.buffer,
        state.dischargeTrack.buffer,
        state.momentumX.buffer,
        state.momentumY.buffer,
        state.momentumXTrack.buffer,
        state.momentumYTrack.buffer,
        analysis.heightHistogram.buffer,
        analysis.normHistogram.buffer,
      ],
    );
  } catch (error) {
    _reportWorkerError("onmessage", error);
  }
};
