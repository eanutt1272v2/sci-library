class Media extends MediaCore {
  constructor(appcore) {
    super(appcore, "[Psi][Media]");
  }

  exportParamsJSON() {
    const payload = {
      format: "simpipe.params",
      metadata: this._getMetadataSnapshot(),
      params: this._cloneJSONCompatible(this.appcore.params),
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
        this.appcore.refreshGUI();
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

    this._mergeByTargetSchema(this.appcore.params, data.params);

    if (typeof this.appcore._sanitisePhysicalParams === "function") {
      this.appcore._sanitisePhysicalParams();
    }

    this.appcore.gui.enforceConstraints();
    this.appcore.syncViewConstraints();
  }

  _getMetadataSnapshot() {
    return this._cloneJSONCompatible(this.appcore.metadata || {});
  }

  _getStatisticsSnapshot() {
    return {
      statistics: this._cloneJSONCompatible(this.appcore.statistics || {}),
      series: this._getSeriesSnapshot(),
    };
  }

  _getSeriesSnapshot(limit = 10000) {
    const source = Array.isArray(this.appcore.analyser?.series)
      ? this.appcore.analyser.series
      : [];
    const safe = this._cloneJSONCompatible(source);
    if (!Array.isArray(safe)) return [];
    return safe.length <= limit ? safe : safe.slice(safe.length - limit);
  }

  _getFilename(extension) {
    const { name, version } = this.appcore.metadata;
    const { orbitalNotation } = this.appcore.params;
    const safeOrbital = (orbitalNotation || "orbital")
      .replace(/\s+/g, "_")
      .replace(/[()=]/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    const ts = Date.now();

    return `${name}_${version}_${safeOrbital}_${ts}.${extension}`;
  }
}
