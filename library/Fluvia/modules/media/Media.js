import { RLECodec } from "../model/RLECodec.js";

/**
 * Media handles import/export. It extends the shared `MediaCore` (a frozen
 * classic-global file in `_shared/utils` — not yet an ES module, loaded via a
 * plain `<script>` tag before this module, so the bare `MediaCore` identifier
 * resolves via the shared top-level lexical scope) which stores its
 * constructor argument as `this.appcore`. That field name is fixed by the
 * frozen parent class, but the *value* passed in from `AppCore` is the narrow
 * Media facade below (`{params, statistics, colourMaps, metadata, terrain,
 * refreshGUI, queueAction, sanitiseParams, normaliseTerrainSize,
 * reallocateTerrainBuffers, withWorkerPaused, resizeTerrain,
 * reinitialiseAnalyser, reinitialise, p}`) — never the real `AppCore`
 * instance — so `this.appcore.X` below always resolves against that facade.
 */
class Media extends MediaCore {
  constructor(facade) {
    super(facade, "[Fluvia][Media]");
    this._heightmapExportDeferred = false;
    this._worldExportDeferred = false;
    this._maxEncodedMapChars = 32 * 1024 * 1024;

    this.importInput = this._createHiddenInput("image/*", (file) =>
      this.handleHeightmapImport(file),
    );
  }

  openImportDialog() {
    this.importInput.value = "";
    this.importInput.click();
  }

  handleHeightmapImport(file) {
    if (!file?.type.startsWith("image")) {
      this._logError("Heightmap import failed: provided file is not an image");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const imgSrc = event.target.result;

      this.appcore.p.loadImage(
        imgSrc,
        (img) => {
          try {
            const { terrain } = this.appcore;
            const {
              size,
              area,
              heightMap,
              bedrockMap,
              originalHeightMap,
              sedimentMap,
            } = terrain;

            if (!img) throw new Error("[Fluvia] loadImage returned null");

            img.resize(size, size);

            const sourceCanvas = img.canvas;
            if (!(sourceCanvas instanceof HTMLCanvasElement)) {
              throw new Error("[Fluvia] Imported image has no readable canvas");
            }

            const readbackCanvas = document.createElement("canvas");
            readbackCanvas.width = size;
            readbackCanvas.height = size;

            let readCtx = null;
            try {
              readCtx = readbackCanvas.getContext("2d", {
                willReadFrequently: true,
              });
            } catch {
              readCtx = readbackCanvas.getContext("2d");
            }

            if (!readCtx) {
              throw new Error("[Fluvia] Could not acquire 2D readback context");
            }

            readCtx.drawImage(sourceCanvas, 0, 0, size, size);
            const pixels = readCtx.getImageData(0, 0, size, size).data;
            if (!pixels || pixels.length < area * 4) {
              throw new Error("[Fluvia] Pixel buffer incomplete");
            }

            for (let i = 0; i < area; i++) {
              const idx = i << 2;
              const brightness =
                (0.2126 * pixels[idx] +
                  0.7152 * pixels[idx + 1] +
                  0.0722 * pixels[idx + 2]) /
                255;

              heightMap[i] = bedrockMap[i] = originalHeightMap[i] = brightness;
              sedimentMap[i] = 0;
            }

            terrain.reset();
            this.appcore.refreshGUI();
            this._logInfo(`Heightmap imported: ${size}x${size}`);
          } catch (err) {
            this._logError("Heightmap import failed during processing:", err);
          }
        },
        (err) => this._logError("Heightmap import failed: load error", err),
      );
    };

    reader.readAsDataURL(file);
  }

  dispose() {
    super.dispose();
    this._removeHiddenInput(this.importInput);
    this.importInput = null;
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
        if (!data || typeof data !== "object" || !data.params) {
          throw new Error("[Fluvia] Invalid params JSON payload");
        }
        if (data.format !== "simpipe.params") {
          throw new Error("[Fluvia] Invalid params JSON format version");
        }

        this._applyMetadataSnapshot(data.metadata);

        const oldSize = this.appcore.params.terrainSize;
        this._applyParamsSnapshot(data.params);

        if (this.appcore.params.terrainSize !== oldSize) {
          this.appcore.reinitialise();
        }

        this.appcore.refreshGUI();
        this._logInfo("Params JSON imported");
      });
    });
  }

  exportStatisticsJSON() {
    const payload = {
      format: "simpipe.statistics",
      metadata: this._getMetadataSnapshot(),
      statistics: this._serialiseStatistics(),
      series: [],
      exportedAt: new Date().toISOString(),
    };
    this._downloadJSON(payload, this._getFilename("statistics.json"));
    this._logInfo("Statistics JSON exported");
  }

  exportStatisticsCSV() {
    const metadataJson = JSON.stringify(this.appcore.metadata || {});
    const exportedAt = new Date().toISOString();
    const rows = [["key", "value"]];
    this._flattenToRows(this._serialiseStatistics(), "", rows);

    const csv =
      `# exportedAt: ${exportedAt}\n` +
      `# metadata: ${metadataJson}\n` +
      rows
        .map((r) => `${this._toCSVCell(r[0])},${this._toCSVCell(r[1])}`)
        .join("\n");
    this._downloadText(csv, this._getFilename("statistics.csv"), "text/csv");
    this._logInfo("Statistics CSV exported");
  }

  exportWorldJSON() {
    const { terrain } = this.appcore;
    const hasBuffers = terrain.floatMapKeys.some((k) => terrain[k]);

    if (!hasBuffers) {
      if (!this._worldExportDeferred) {
        this._worldExportDeferred = true;
        if (typeof this.appcore.queueAction === "function") {
          this.appcore.queueAction("exportWorldJSON", () => {
            this._worldExportDeferred = false;
            this.exportWorldJSON();
          });
          this._logInfo(
            "World export deferred until worker returns terrain buffers",
          );
        } else {
          this._worldExportDeferred = false;
          this._logWarn(
            "Cannot export world while worker holds terrain buffers",
          );
        }
      }
      return;
    }

    this._worldExportDeferred = false;

    const maps = {};
    for (const key of terrain.floatMapKeys) {
      if (terrain[key] instanceof Float32Array) {
        maps[key] = this._encodeWorldMap(terrain[key]);
      }
    }

    const payload = {
      format: "simpipe.world",
      metadata: this._getMetadataSnapshot(),
      params: this._cloneJSONCompatible(this.appcore.params),
      statistics: this._serialiseStatistics(),
      series: [],
      world: {
        terrainSize: terrain.size,
        maps,
      },
      exportedAt: new Date().toISOString(),
    };

    this._downloadJSON(payload, this._getFilename("world.json"));
    this._logInfo(`World JSON exported: size=${terrain.size}`);
  }

  importWorldJSON() {
    this.openDataImportDialog((file) => {
      this._readJSONFile(file, (data) => {
        if (
          !data ||
          typeof data !== "object" ||
          data.format !== "simpipe.world" ||
          !data.params ||
          !data.statistics ||
          !Array.isArray(data.series) ||
          !data.world ||
          !data.world.maps ||
          !data.world.terrainSize
        ) {
          throw new Error("[Fluvia] Invalid world JSON payload");
        }

        this._applyMetadataSnapshot(data.metadata);

        const world = data.world;
        const maps = world.maps;

        const { terrain } = this.appcore;
        for (const key of terrain.floatMapKeys) {
          if (!this._isEncodedWorldMap(maps[key])) {
            throw new Error(`[Fluvia] Invalid world JSON: missing maps.${key}`);
          }
        }

        const incomingSize = Number(world.terrainSize);
        if (!Number.isFinite(incomingSize) || incomingSize <= 0) {
          throw new Error("[Fluvia] Invalid world JSON: invalid terrainSize");
        }

        const normalisedSize = this.appcore.normaliseTerrainSize(incomingSize);
        let importedTerrain;

        this.appcore.withWorkerPaused(() => {
          if (normalisedSize !== this.appcore.params.terrainSize) {
            this.appcore.resizeTerrain(normalisedSize);
          } else {
            this.appcore.reallocateTerrainBuffers();
          }

          importedTerrain = this.appcore.terrain;
          for (const key of importedTerrain.floatMapKeys) {
            if (this._isEncodedWorldMap(maps[key])) {
              this._copyArrayInto(
                importedTerrain[key],
                this._decodeWorldMap(maps[key], importedTerrain[key].length),
              );
            }
          }

          importedTerrain.updateBoundsCache();
          this.appcore.reinitialiseAnalyser();
          this._applyParamsSnapshot(data.params, {
            forceTerrainSize: normalisedSize,
          });
          this._applyStatisticsSnapshot(data.statistics);
        });

        this.appcore.refreshGUI();
        this._logInfo(`World JSON imported: size=${importedTerrain.size}`);
      });
    });
  }

  exportHeightmapPNG() {
    const { terrain } = this.appcore;
    if (!terrain || !terrain.heightMap) {
      if (!this._heightmapExportDeferred) {
        this._heightmapExportDeferred = true;
        if (typeof this.appcore.queueAction === "function") {
          this.appcore.queueAction("exportHeightmapPNG", () => {
            this._heightmapExportDeferred = false;
            this.exportHeightmapPNG();
          });
          this._logInfo(
            "Heightmap export deferred until worker returns terrain buffers",
          );
        } else {
          this._heightmapExportDeferred = false;
          this._logWarn(
            "Cannot export heightmap while worker holds terrain buffers",
          );
        }
      }
      return;
    }

    this._heightmapExportDeferred = false;

    setTimeout(() => this._exportHeightmapPNGNow(), 0);
  }

  _exportHeightmapPNGNow() {
    const { terrain } = this.appcore;
    if (!terrain || !terrain.heightMap) {
      this._logWarn("Heightmap export aborted: terrain buffers unavailable");
      return;
    }

    const size = terrain.size;
    const statisticsBounds = this.appcore?.statistics?.heightBounds;
    const statisticsMin = Number(statisticsBounds?.min);
    const statisticsMax = Number(statisticsBounds?.max);
    const bounds =
      Number.isFinite(statisticsMin) && Number.isFinite(statisticsMax)
        ? { min: statisticsMin, max: statisticsMax }
        : terrain.getMapBounds(terrain.heightMap);
    const range = Math.max(1e-9, bounds.max - bounds.min);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(size, size);
    const pixels = imageData.data;

    for (let i = 0; i < terrain.heightMap.length; i++) {
      const v = (terrain.heightMap[i] - bounds.min) / range;
      const g = Math.max(0, Math.min(255, Math.round(v * 255)));
      const p = i * 4;
      pixels[p] = g;
      pixels[p + 1] = g;
      pixels[p + 2] = g;
      pixels[p + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        this._logError("Failed to export heightmap PNG blob");
        return;
      }
      this._triggerDownload(
        URL.createObjectURL(blob),
        this._getFilename("heightmap.png"),
      );
      this._logInfo(`Heightmap PNG exported: ${size}x${size}`);
    }, "image/png");
  }

  _copyArrayInto(target, source) {
    if (!target || !ArrayBuffer.isView(source)) {
      throw new Error("[Fluvia] Invalid map buffer during world import");
    }
    if (source.length !== target.length) {
      throw new Error(
        `[Fluvia] Invalid map length during world import: expected ${target.length}, got ${source.length}`,
      );
    }

    for (let i = 0; i < target.length; i++) {
      const value = Number(source[i]);
      target[i] = Number.isFinite(value) ? value : 0;
    }
  }

  _encodeWorldMap(source) {
    if (!(source instanceof Float32Array)) {
      throw new Error("[Fluvia] Invalid world map during export");
    }

    return {
      encoding: "rle-f32-v1",
      length: source.length,
      data: RLECodec.encodeFloat32Array(source),
    };
  }

  _isEncodedWorldMap(source) {
    return (
      source &&
      typeof source === "object" &&
      source.encoding === "rle-f32-v1" &&
      Number.isFinite(Number(source.length)) &&
      Number(source.length) > 0 &&
      typeof source.data === "string"
    );
  }

  _decodeWorldMap(source, expectedLength) {
    if (!this._isEncodedWorldMap(source)) {
      throw new Error("[Fluvia] Invalid encoded world map during import");
    }

    const length = Number(source.length);
    if (length !== expectedLength) {
      throw new Error(
        `[Fluvia] Invalid encoded world map length: expected ${expectedLength}, got ${length}`,
      );
    }

    if (source.data.length > this._maxEncodedMapChars) {
      throw new Error("[Fluvia] Encoded world map exceeds size limit");
    }

    return RLECodec.decodeFloat32Array(source.data, length);
  }

  _applyParamsSnapshot(incoming, options = {}) {
    if (!incoming || typeof incoming !== "object") return;

    const target = this.appcore.params;
    this._mergeByTargetSchema(target, incoming);

    if (typeof this.appcore.sanitiseParams === "function") {
      this.appcore.sanitiseParams();
    }

    if (typeof options.forceTerrainSize === "number") {
      target.terrainSize = this.appcore.normaliseTerrainSize(
        options.forceTerrainSize,
      );
    }
  }

  _applyStatisticsSnapshot(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    this._mergeByTargetSchema(this.appcore.statistics, incoming);
  }

  _serialiseStatistics() {
    return this._cloneJSONCompatible(this.appcore.statistics || {});
  }

  _getMetadataSnapshot() {
    return this._cloneJSONCompatible(this.appcore.metadata || {});
  }

  _flattenToRows(value, prefix, rows) {
    if (Array.isArray(value)) {
      rows.push([prefix || "value", JSON.stringify(value)]);
      return;
    }

    if (this._isPlainObject(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        this._flattenToRows(entry, nextPrefix, rows);
      }
      return;
    }

    rows.push([prefix || "value", value]);
  }

  _toCSVCell(value) {
    const text = String(value ?? "");
    if (!/[",\n]/.test(text)) {
      return text;
    }
    return `"${text.replace(/"/g, '""')}"`;
  }

  _getFilename(extension) {
    const { terrainSize, surfaceMap, renderMethod } = this.appcore.params;
    const { name, version } = this.appcore.metadata;
    const ts = Date.now();

    return `${name}_${version}_${renderMethod}_${surfaceMap}_${terrainSize}_${ts}.${extension}`;
  }
}

export { Media };
