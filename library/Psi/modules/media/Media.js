import { PSI_SCHEMA } from "../core/ParamSchema.js";

/**
 * Media — Psi's import/export/recording surface.
 *
 * Extends the shared `MediaCore` (a classic-script global from
 * `_shared/utils/MediaCore.js`; not yet an ES module — frozen as part of the
 * Stage A shared-layer work, hence no `import` here). `MediaCore` itself reads
 * `this.appcore.params` / `this.appcore.refreshGUI()` internally, so the value
 * passed to `super()` must satisfy that shape — this is exactly Media's own
 * narrow facade (`{store, params, statistics, analyser, metadata, refreshGUI,
 * enforceConstraints, syncViewConstraints, sanitiseParams}`), not a
 * back-reference to the full AppCore.
 */
class Media extends MediaCore {
  /**
   * @param {Object} facade - Media's view of AppCore: `{store, params,
   *   statistics, analyser, metadata, refreshGUI, enforceConstraints,
   *   syncViewConstraints, sanitiseParams}`.
   */
  constructor(facade) {
    super(facade, "[Psi][Media]");
    this.facade = facade;
  }

  exportParamsJSON() {
    const payload = {
      format: "simpipe.params",
      metadata: this._getMetadataSnapshot(),
      params: this._cloneJSONCompatible(this.facade.params),
      exportedAt: new Date().toISOString(),
    };
    this._downloadJSON(payload, this._getFilename("params.json"));
    this._logInfo("Params JSON exported");
  }

  importParamsJSON() {
    this.openDataImportDialog((file) => {
      this._readJSONFile(file, (data) => {
        this._applyMetadataSnapshot(data.metadata);
        this._applyParamsPayload(data);
        this.facade.refreshGUI();
        this._logInfo("Params JSON imported");
      });
    });
  }

  exportStatisticsJSON() {
    const statistics = this._getStatisticsSnapshot();
    const payload = {
      format: "simpipe.statistics",
      metadata: this._getMetadataSnapshot(),
      statistics: statistics.statistics,
      series: statistics.series,
      exportedAt: new Date().toISOString(),
    };
    this._downloadJSON(payload, this._getFilename("statistics.json"));
    this._logInfo(`Statistics JSON exported: rows=${payload.series.length}`);
  }

  exportStatisticsCSV() {
    const metadataJson = JSON.stringify(this._getMetadataSnapshot());
    const exportedAt = new Date().toISOString();
    const series = this._getSeriesSnapshot();
    const header = [
      "fps",
      "density",
      "peakDensity",
      "mean",
      "stdDev",
      "entropy",
      "concentration",
      "radialPeak",
      "radialSpread",
      "nodeEstimate",
      "n",
      "l",
      "m",
      "resolution",
      "viewRadius",
    ];
    const rows = [
      `# exportedAt: ${exportedAt}`,
      `# metadata: ${metadataJson}`,
      header.join(","),
    ];
    for (const row of series) {
      rows.push(
        (Array.isArray(row) ? row : []).map((v) => Number(v) || 0).join(","),
      );
    }
    this._downloadText(
      rows.join("\n"),
      this._getFilename("statistics.csv"),
      "text/csv",
    );
    this._logInfo(`Statistics CSV exported: rows=${series.length}`);
  }

  _applyParamsPayload(data) {
    if (!data || typeof data !== "object" || !data.params) {
      throw new Error("[Psi] Invalid params JSON payload");
    }
    if (data.format !== "simpipe.params") {
      throw new Error("[Psi] Invalid params JSON format version");
    }

    // ParamStore's enum coercion is an exact match against its (lowercase)
    // option list — it has no notion of normalising case the way the old
    // pre-rearchitecture import path did. Restore that here so a hand-edited
    // or externally-produced "PNG"/"JPG" is accepted instead of silently
    // reverting to the default.
    if (typeof data.params.imageFormat === "string") {
      data.params.imageFormat = data.params.imageFormat.toLowerCase();
    }

    // An invalid/missing nucleusMassKg used to fall back to a nuclearCharge-
    // scaled proton-mass estimate, not the bare proton mass — ParamStore's
    // generic float coercion has no notion of another param, so restore that
    // scaling here before the value ever reaches the store.
    if (data.params.nucleusMassKg !== undefined) {
      const importedMass = Number(data.params.nucleusMassKg);
      if (!Number.isFinite(importedMass) || importedMass <= 0) {
        const protonMassKg = PSI_SCHEMA.nucleusMassKg.default;
        const Z = Math.max(
          1,
          Math.round(
            Number(data.params.nuclearCharge ?? this.facade.params.nuclearCharge) || 1,
          ),
        );
        data.params.nucleusMassKg =
          Z === 1 ? protonMassKg : Math.max(protonMassKg, Z * protonMassKg);
      }
    }

    this._mergeByTargetSchema(this.facade.params, data.params);

    // Confirmed bug fix (was: this.appcore._sanitisePhysicalParams(), a method
    // that never existed — silently no-op'd behind a typeof guard). Resolved
    // through the facade's own naming rather than reinstating the old
    // (also-wrong) call site.
    this.facade.sanitiseParams();

    this.facade.enforceConstraints();
    this.facade.syncViewConstraints();
  }

  _getMetadataSnapshot() {
    return this._cloneJSONCompatible(this.facade.metadata || {});
  }

  _getStatisticsSnapshot() {
    return {
      statistics: this._cloneJSONCompatible(this.facade.statistics || {}),
      series: this._getSeriesSnapshot(),
    };
  }

  _getSeriesSnapshot(limit = 10000) {
    const source = Array.isArray(this.facade.analyser?.series)
      ? this.facade.analyser.series
      : [];
    const safe = this._cloneJSONCompatible(source);
    if (!Array.isArray(safe)) return [];
    return safe.length <= limit ? safe : safe.slice(safe.length - limit);
  }

  _getFilename(extension) {
    const { name, version } = this.facade.metadata;
    const { orbitalNotation } = this.facade.statistics;
    const safeOrbital = (orbitalNotation || "orbital")
      .replace(/\s+/g, "_")
      .replace(/[()=]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    const ts = Date.now();

    return `${name}_${version}_${safeOrbital}_${ts}.${extension}`;
  }
}

export { Media };
