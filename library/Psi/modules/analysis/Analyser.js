class Analyser {
  constructor(statistics = null) {
    this.series = [];
    this.statistics = statistics || {
      fps: 0,
      density: 0,
      peakDensity: 0,
      mean: 0,
      stdDev: 0,
      entropy: 0,
      concentration: 0,
      radialPeak: 0,
      radialSpread: 0,
      nodeEstimate: 0,
    };

    this.reset();
  }

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  reset() {
    this.series = [];
  }

  // -------------------------------------------------------------------------
  // Node-overlay geometry
  // -------------------------------------------------------------------------

  _refineRootBisection(fn, left, right, iterations = 48) {
    let a = left;
    let b = right;
    let fa = fn(a);
    let fb = fn(b);

    if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
    if (Math.abs(fa) <= 1e-12) return a;
    if (Math.abs(fb) <= 1e-12) return b;
    if (fa * fb > 0) return null;

    for (let i = 0; i < iterations; i++) {
      const mid = 0.5 * (a + b);
      const fm = fn(mid);
      if (!Number.isFinite(fm)) return null;
      if (Math.abs(fm) <= 1e-12) return mid;
      if (fa * fm <= 0) {
        b = mid;
        fb = fm;
      } else {
        a = mid;
        fa = fm;
      }
    }

    return 0.5 * (a + b);
  }

  _collectAngularNodeThetas(l, mAbs) {
    const angularCount = Math.max(0, l - mAbs);
    if (angularCount <= 0) return [];

    const fn = (u) => QMath.assocLegendre(l, mAbs, u);
    const roots = [];
    const steps = 2048;
    const minU = -0.999999;
    const maxU = 0.999999;
    const du = (maxU - minU) / steps;

    let prevU = minU;
    let prevF = fn(prevU);

    for (let i = 1; i <= steps; i++) {
      const u = minU + i * du;
      const f = fn(u);
      if (!Number.isFinite(f)) {
        prevU = u;
        prevF = f;
        continue;
      }

      if (Math.abs(f) <= 1e-8) {
        roots.push(u);
      } else if (Number.isFinite(prevF) && prevF * f < 0) {
        const refined = this._refineRootBisection(fn, prevU, u);
        if (Number.isFinite(refined)) roots.push(refined);
      }

      prevU = u;
      prevF = f;
    }

    roots.sort((a, b) => a - b);
    const deduped = [];
    for (const root of roots) {
      if (deduped.length === 0 || Math.abs(root - deduped[deduped.length - 1]) > 1e-4) {
        deduped.push(root);
      }
    }

    return deduped
      .slice(0, angularCount)
      .map((u) => Math.acos(Math.max(-1, Math.min(1, u))));
  }

  _collectAzimuthalNodePhis(mAbs) {
    const count = Math.max(0, Math.round(Number(mAbs) || 0));
    if (count <= 0) return [];

    const phis = [];
    for (let k = 0; k < count; k++) {
      phis.push(((k + 0.5) * Math.PI) / count);
    }
    return phis;
  }

  _collectRadialNodeRadiiA0(n, l, z, toA0) {
    const radialCount = Math.max(0, n - l - 1);
    if (radialCount <= 0) return [];

    const alpha = 2 * l + 1;
    const laguerre = (rho) => QMath.genLaguerre(radialCount, alpha, rho);
    const roots = [];
    const maxRho = Math.max(64, 8 * n * n);
    const steps = 4096;
    const drho = maxRho / steps;

    let prevRho = 1e-6;
    let prevF = laguerre(prevRho);

    for (let i = 1; i <= steps; i++) {
      const rho = i * drho;
      const f = laguerre(rho);
      if (!Number.isFinite(f)) {
        prevRho = rho;
        prevF = f;
        continue;
      }

      if (Math.abs(f) <= 1e-8) {
        roots.push(rho);
      } else if (Number.isFinite(prevF) && prevF * f < 0) {
        const refined = this._refineRootBisection(laguerre, prevRho, rho);
        if (Number.isFinite(refined)) roots.push(refined);
      }

      prevRho = rho;
      prevF = f;
    }

    roots.sort((a, b) => a - b);
    const deduped = [];
    for (const root of roots) {
      if (deduped.length === 0 || Math.abs(root - deduped[deduped.length - 1]) > 1e-4) {
        deduped.push(root);
      }
    }

    return deduped
      .slice(0, radialCount)
      .map((rho) => ((n * rho) / (2 * z)) * toA0);
  }

  // -------------------------------------------------------------------------
  // Node-overlay data (called per-frame from Renderer; cached in commit #N)
  // -------------------------------------------------------------------------

  computeNodeOverlayData(params) {
    const n = Math.max(1, Math.round(Number(params?.n) || 1));
    const l = Math.max(0, Math.min(n - 1, Math.round(Number(params?.l) || 0)));
    const mAbs = Math.min(l, Math.abs(Math.round(Number(params?.m) || 0)));
    const z = Math.max(1, Math.round(Number(params?.nuclearCharge) || 1));

    const aMuMeters =
      Number(params?.aMuMeters) > 0
        ? Number(params.aMuMeters)
        : 5.29177210903e-11;
    const a0Meters = 5.29177210903e-11;
    const toA0 = aMuMeters / a0Meters;

    return {
      radialNodeRadii:   this._collectRadialNodeRadiiA0(n, l, z, toA0),
      angularNodeThetas: this._collectAngularNodeThetas(l, mAbs),
      angularNodePhis:   this._collectAzimuthalNodePhis(mAbs),
    };
  }

  // -------------------------------------------------------------------------
  // Statistics — applied from worker results only
  // -------------------------------------------------------------------------

  applyWorkerStatistics(workerStatistics, params) {
    if (!workerStatistics || typeof workerStatistics !== "object") return;

    const toFinite = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    };

    this.statistics.density       = toFinite(workerStatistics.density);
    this.statistics.peakDensity   = toFinite(workerStatistics.peakDensity);
    this.statistics.mean          = toFinite(workerStatistics.mean);
    this.statistics.stdDev        = toFinite(workerStatistics.stdDev);
    this.statistics.entropy       = toFinite(workerStatistics.entropy);
    this.statistics.concentration = toFinite(workerStatistics.concentration);
    this.statistics.radialPeak    = toFinite(workerStatistics.radialPeak);
    this.statistics.radialSpread  = toFinite(workerStatistics.radialSpread);
    this.statistics.nodeEstimate  = toFinite(workerStatistics.nodeEstimate);

    this.recordStatistics(params);
  }

  // -------------------------------------------------------------------------
  // Series recording
  // -------------------------------------------------------------------------

  recordStatistics(params) {
    const row = [
      Number(params?.fps)        || 0,
      this.statistics.density,
      this.statistics.peakDensity,
      this.statistics.mean,
      this.statistics.stdDev,
      this.statistics.entropy,
      this.statistics.concentration,
      this.statistics.radialPeak,
      this.statistics.radialSpread,
      this.statistics.nodeEstimate,
      params?.n          || 0,
      params?.l          || 0,
      params?.m          || 0,
      params?.resolution || 0,
      params?.viewRadius || 0,
    ];

    this.series.push(row);
    if (this.series.length > 10000) {
      this.series.shift();
    }
  }

  // -------------------------------------------------------------------------
  // Import / Export
  // -------------------------------------------------------------------------

  exportJSON() {
    return {
      statistics: { ...this.statistics },
      series: Array.isArray(this.series) ? this.series : [],
    };
  }

  importJSON(data) {
    if (data && typeof data === "object" && Array.isArray(data.series)) {
      this.series = data.series.map((row) =>
        Array.isArray(row) ? row.map((v) => Number(v) || 0) : [],
      );
    }
  }

  getStatisticsRow() {
    const keys = [
      "density",
      "peakDensity",
      "mean",
      "stdDev",
      "entropy",
      "concentration",
      "radialPeak",
      "radialSpread",
      "nodeEstimate",
    ];
    const row = {};
    keys.forEach((key) => {
      row[key] = Number(this.statistics[key]) || 0;
    });
    return row;
  }
}
