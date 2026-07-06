import { scheduleFrameFriendlyTask } from "../../../_shared/utils/FrameScheduler.js";
import { FormatUtils } from "../../../_shared/utils/FormatUtils.js";
import { FLUVIA_SCHEMA } from "../core/ParamSchema.js";

class GUI {
  /**
   * @param {Object} facade - Narrow GUI dependencies: the live `params` view,
   *   the `store` (for resolving current bounds via `getRange`), `statistics`,
   *   `metadata`, `colourMaps`, the `media` sibling, and discrete AppCore
   *   commands (`generate`, `reset`). No AppCore back-reference. Fluvia has no
   *   render-queue or relative-bound constraint-sync concept (unlike Psi), so
   *   this facade omits `requestRender`/`syncViewConstraints` — there is
   *   nothing here to swap them in for. `cycleColourMap`/`cycleSurfaceMap` are
   *   InputHandler's commands, not GUI's — GUI has no control that invokes
   *   either.
   */
  constructor(facade) {
    this.params = facade.params;
    this.store = facade.store;
    this.statistics = facade.statistics;
    this.metadata = facade.metadata;
    this.colourMaps = facade.colourMaps;
    this.media = facade.media;
    this.generate = facade.generate;
    this.reset = facade.reset;

    this.recordButton = null;
    this._tabsReady = false;
    this._disposed = false;
    const { name, version, author } = this.metadata;

    this.pane = new Tweakpane.Pane({
      title: `${name} ${version} by ${author}`,
      expanded: true,
    });

    const buildTabs = () => {
      if (this._disposed) return;
      if (this._tabsReady) return;
      this.setupTabs();
      this._tabsReady = true;
    };

    scheduleFrameFriendlyTask(buildTabs, {
      label: "Fluvia GUI bootstrap",
      timeoutMs: 240,
      useIdle: true,
    });
  }

  /**
   * Resolve the current Tweakpane binding options for a schema-owned key: its
   * live-resolved bounds (via {@link ParamStore#getRange}) plus its declared
   * step, so range literals are never hand-copied into a binding call.
   *
   * @param {string} key - A key declared in `FLUVIA_SCHEMA`.
   * @param {Object} [extra] - Additional binding options to merge in/override.
   * @returns {Object}
   */
  bindingOptionsFor(key, extra = {}) {
    return { ...this.store.getRange(key), step: FLUVIA_SCHEMA[key]?.step, ...extra };
  }

  setupTabs() {
    const tabs = this.pane.addTab({
      pages: [
        { title: "Simulation" },
        { title: "Parameters" },
        { title: "Rendering" },
        { title: "Statistics" },
        { title: "Media" },
      ],
    });

    const [simPage, paramsPage, renderPage, statisticsPage, mediaPage] =
      tabs.pages;
    this.createSimulationTab(simPage);
    this.createParametersTab(paramsPage);
    this.createRenderTab(renderPage);
    this.createStatisticsTab(statisticsPage);
    this.createMediaTab(mediaPage);
  }

  addSeparator(target) {
    target.addBlade({ view: "separator" });
  }

  withHint(label, id, fallback = "") {
    if (typeof KeybindCatalogue === "undefined") {
      return fallback ? `${label} (${fallback})` : label;
    }
    return KeybindCatalogue.withHint(label, "fluvia", id, fallback);
  }

  addGraphWithValue(target, objectRef, key, options = {}) {
    const {
      label,
      format,
      min,
      max,
      interval = 200,
      bufferSize = 100,
    } = options;

    const graphBinding = {
      readonly: true,
      label,
      view: "graph",
      interval,
      bufferSize,
    };

    if (typeof min !== "undefined") graphBinding.min = min;
    if (typeof max !== "undefined") graphBinding.max = max;

    target.addBinding(objectRef, key, graphBinding);

    const valueBinding = {
      readonly: true,
      label: "",
    };

    if (typeof format === "function") {
      valueBinding.format = format;
    }

    target.addBinding(objectRef, key, valueBinding);
  }

  createSimulationTab(page) {
    const { params, statistics } = this;

    const controls = page.addFolder({
      title: "Simulation Controls",
      expanded: true,
    });
    controls.addBinding(params, "running", {
      label: this.withHint("Running", "running", "P/Space"),
    });
    controls
      .addButton({ title: this.withHint("Generate Terrain", "generate", "G") })
      .on("click", () => this.generate());
    controls
      .addButton({ title: this.withHint("Reset Terrain", "reset", "R") })
      .on("click", () => this.reset());

    this.addSeparator(page);

    const perf = page.addFolder({
      title: "Performance Metrics",
      expanded: true,
    });
    perf.addBinding(statistics, "fps", {
      readonly: true,
      label: "FPS [Hz]",
      view: "graph",
      interval: 60,
      min: 0,
      max: 100,
    });
    perf.addBinding(statistics, "simulationTime", {
      label: "Simulation Time [s]",
      readonly: true,
    });

    this.addSeparator(page);

    const droplets = page.addFolder({
      title: "Droplet Settings",
      expanded: true,
    });
    droplets.addBinding(
      params,
      "dropletsPerFrame",
      this.bindingOptionsFor("dropletsPerFrame", {
        label: this.withHint("Droplets/Frame", "droplets", "I/K"),
      }),
    );

    droplets.addBinding(
      params,
      "maxAge",
      this.bindingOptionsFor("maxAge", {
        label: this.withHint("Max Age", "maxAge", "Ctrl+U/J"),
      }),
    );

    droplets.addBinding(
      params,
      "minVolume",
      this.bindingOptionsFor("minVolume", {
        label: this.withHint("Min Volume", "minVolume", "Ctrl+Y/H"),
      }),
    );

    this.addSeparator(page);

    const genFolder = page.addFolder({
      title: "Terrain Generation",
      expanded: true,
    });

    genFolder.addBinding(params, "terrainSize", {
      label: this.withHint("Size", "terrainSize", "Ctrl+1/2/3"),
      options: { "128×128": 128, "256×256": 256, "512×512": 512 },
    });

    genFolder.addBinding(
      params,
      "noiseScale",
      this.bindingOptionsFor("noiseScale", {
        label: this.withHint("Scale", "noiseScale", "Ctrl+[/]"),
      }),
    );

    genFolder.addBinding(
      params,
      "noiseOctaves",
      this.bindingOptionsFor("noiseOctaves", {
        label: this.withHint("Octaves", "noiseOctaves", "Ctrl+;/'"),
      }),
    );

    this.addSeparator(page);

    const keymapShortcut =
      typeof KeybindCatalogue === "undefined"
        ? "#"
        : KeybindCatalogue.getHint("fluvia", "keymapReference", "#");
    const keymapHint = {
      text: `Press ${keymapShortcut} to open keymap reference`,
    };
    page.addBinding(keymapHint, "text", {
      label: "Hint",
      readonly: true,
    });
  }

  createParametersTab(page) {
    const { params } = this;
    const hydraulic = page.addFolder({
      title: "Hydraulic Erosion",
      expanded: true,
    });

    const hydraulicSettings = [
      { key: "sedimentErosionRate", label: "Sediment Erosion" },
      { key: "bedrockErosionRate", label: "Bedrock Erosion" },
      { key: "depositionRate", label: "Deposition" },
      { key: "evaporationRate", label: "Evaporation" },
      { key: "precipitationRate", label: "Precipitation" },
      { key: "entrainment", label: "Entrainment" },
      { key: "gravity", label: "Gravity" },
      { key: "momentumTransfer", label: "Momentum Transfer" },
      { key: "learningRate", label: "Learning Rate" },
    ];

    hydraulicSettings.forEach((s) =>
      hydraulic.addBinding(
        params,
        s.key,
        this.bindingOptionsFor(s.key, { label: s.label }),
      ),
    );

    this.addSeparator(page);

    const thermal = page.addFolder({
      title: "Thermal Erosion",
      expanded: true,
    });

    thermal.addBinding(
      params,
      "maxHeightDiff",
      this.bindingOptionsFor("maxHeightDiff", { label: "Max Δ Height" }),
    );

    thermal.addBinding(
      params,
      "settlingRate",
      this.bindingOptionsFor("settlingRate", { label: "Settling Rate" }),
    );
  }

  createRenderTab(page) {
    const { params, colourMaps } = this;

    const render = page.addFolder({ title: "Map View", expanded: true });

    render.addBinding(params, "renderMethod", {
      label: this.withHint("Render Method", "renderMethod", "1/2"),
      options: { "3D": "3D", "2D": "2D" },
    });

    render.addBinding(params, "surfaceMap", {
      label: this.withHint("Surface Map", "surfaceMap", "M"),
      options: {
        Composite: "composite",
        "Height Map": "height",
        Slope: "slope",
        Discharge: "discharge",
        Sediment: "sediment",
        Delta: "delta",
      },
    });

    const colourMapOptions = Object.keys(colourMaps).reduce((obj, name) => {
      const type = (colourMaps[name] && colourMaps[name].type) || "sequential";
      obj[`${name} (${type})`] = name;
      return obj;
    }, {});

    render.addBinding(params, "colourMap", {
      options: colourMapOptions,
      label: this.withHint("Selected Colour Map", "colourMap", "C"),
    });

    render.addBinding(
      params,
      "heightScale",
      this.bindingOptionsFor("heightScale", {
        label: this.withHint("Height Scale", "heightScale", "[/]"),
      }),
    );

    const camera = page.addFolder({ title: "Camera", expanded: true });

    camera.addBinding(
      params,
      "cameraSmoothing",
      this.bindingOptionsFor("cameraSmoothing", { label: "Motion Smoothing" }),
    );

    camera.addBinding(
      params,
      "cameraOrbitSensitivity",
      this.bindingOptionsFor("cameraOrbitSensitivity", {
        label: "Orbit Sensitivity",
      }),
    );

    camera.addBinding(
      params,
      "cameraZoomSensitivity",
      this.bindingOptionsFor("cameraZoomSensitivity", {
        label: "Zoom Sensitivity",
      }),
    );

    this.addSeparator(page);

    const overlay = page.addFolder({
      title: "Visual Overlays",
      expanded: true,
    });

    overlay.addBinding(params, "renderLegend", {
      label: this.withHint("Toggle Legend", "overlayLegend", "L"),
    });

    this.addSeparator(page);

    const light = page.addFolder({ title: "Lighting", expanded: true });

    light.addBinding(params, "lightDir", {
      label: "Direction",
      x: this.store.getRange("lightDir.x"),
      y: this.store.getRange("lightDir.y"),
      z: this.store.getRange("lightDir.z"),
    });

    light.addBinding(
      params,
      "specularIntensity",
      this.bindingOptionsFor("specularIntensity", {
        label: this.withHint(
          "Specular Intensity",
          "specularIntensity",
          "Ctrl+,/.",
        ),
      }),
    );

    this.addSeparator(page);

    const colours = page.addFolder({ title: "Colour Palette", expanded: true });

    ["sky", "steep", "flat", "sediment", "water"].forEach((type) => {
      colours.addBinding(params, `${type}Colour`, {
        label: type.charAt(0).toUpperCase() + type.slice(1),
      });
    });
  }

  createStatisticsTab(page) {
    const { statistics, params } = this;
    const fmt = FormatUtils.formatFixed;
    const fmtInt = FormatUtils.formatInt;

    const display = page.addFolder({
      title: "Statistics Overlay",
      expanded: true,
    });

    display.addBinding(params, "renderStatistics", {
      label: this.withHint(
        "Toggle Statistics Overlay",
        "overlayStatistics",
        "O",
      ),
    });

    this.addSeparator(page);

    const perfFolder = page.addFolder({ title: "Performance & Time" });

    this.addGraphWithValue(perfFolder, statistics, "fps", {
      label: "FPS [Hz]",
      format: (v) => fmt(v, 1),
      interval: 100,
      bufferSize: 60,
      min: 0,
      max: 120,
    });

    perfFolder.addBinding(statistics, "simulationTime", {
      label: "Simulation Time [s]",
      readonly: true,
      format: (v) => fmt(v, 2),
    });

    perfFolder.addBinding(statistics, "frameCounter", {
      readonly: true,
      label: "Frame Counter [frame]",
      format: fmtInt,
    });

    this.addSeparator(page);

    const elevationFolder = page.addFolder({ title: "Topography" });

    elevationFolder.addBinding(statistics, "avgElevation", {
      readonly: true,
      label: "Average Elevation [height]",
      format: (v) => fmt(v, 3),
    });

    elevationFolder.addBinding(statistics, "elevationStdDev", {
      readonly: true,
      label: "Elevation Std Dev [height]",
      format: (v) => fmt(v, 3),
    });

    elevationFolder.addBinding(statistics.heightBounds, "min", {
      readonly: true,
      label: "Minimum Elevation [height]",
      format: (v) => fmt(v, 3),
    });

    elevationFolder.addBinding(statistics.heightBounds, "max", {
      readonly: true,
      label: "Maximum Elevation [height]",
      format: (v) => fmt(v, 3),
    });

    this.addGraphWithValue(elevationFolder, statistics, "rugosity", {
      label: "Rugosity Index [index]",
      format: (v) => fmt(v, 4),
      min: 0,
      max: 2,
    });

    this.addSeparator(page);

    const hydroFolder = page.addFolder({ title: "Hydrology" });

    this.addGraphWithValue(hydroFolder, statistics, "totalWater", {
      label: "Volume of Water [volume]",
      format: (v) => fmt(v, 2),
      min: 0,
      max: 128000,
    });

    this.addGraphWithValue(hydroFolder, statistics, "activeWaterCover", {
      label: "Active Water Cells [cells]",
      format: (v) => fmt(v, 2),
      min: 0,
      max: 65536,
    });

    this.addGraphWithValue(hydroFolder, statistics, "drainageDensity", {
      label: "Drainage Density [%]",
      format: (v) => fmt(v, 2),
      min: 0,
      max: 50,
    });

    this.addGraphWithValue(hydroFolder, statistics, "hydraulicResidence", {
      label: "Residence Time [s]",
      format: (v) => fmt(v, 2),
      min: 0,
      max: 1500,
    });

    hydroFolder.addBinding(statistics.dischargeBounds, "min", {
      readonly: true,
      label: "Discharge Minimum [norm]",
      format: (v) => fmt(v, 3),
      min: 0,
      max: 1,
    });

    hydroFolder.addBinding(statistics.dischargeBounds, "max", {
      readonly: true,
      label: "Discharge Maximum [norm]",
      format: (v) => fmt(v, 3),
      min: 0,
      max: 1,
    });

    this.addSeparator(page);

    const geomorphFolder = page.addFolder({
      title: "Mass Balance",
      expanded: false,
    });

    this.addGraphWithValue(geomorphFolder, statistics, "erosionRate", {
      label: "Total Erosion Rate [volume/s]",
      format: (v) => fmt(v, 3),
      min: 0,
      max: 750,
    });

    this.addGraphWithValue(geomorphFolder, statistics, "sedimentFlux", {
      label: "Sediment Flux [volume/s]",
      format: (v) => fmt(v, 3),
      min: -50,
      max: 512,
    });

    this.addGraphWithValue(geomorphFolder, statistics, "totalSediment", {
      label: "Total Sediment [volume]",
      format: (v) => fmt(v, 2),
      min: 0,
      max: 2048,
    });

    this.addGraphWithValue(geomorphFolder, statistics, "totalBedrock", {
      label: "Total Bedrock [volume]",
      format: (v) => fmt(v, 2),
      min: 0,
      max: 40000,
    });

    this.addGraphWithValue(geomorphFolder, statistics.sedimentBounds, "min", {
      label: "Sediment Minimum [norm]",
      format: (v) => fmt(v, 3),
      min: 0,
      max: 1,
    });

    this.addGraphWithValue(geomorphFolder, statistics.sedimentBounds, "max", {
      label: "Sediment Maximum [norm]",
      format: (v) => fmt(v, 3),
      min: 0,
      max: 1,
    });

    this.addGraphWithValue(geomorphFolder, statistics, "slopeComplexity", {
      label: "Slope Complexity Index [index]",
      format: (v) => fmt(v, 4),
      min: 0,
      max: 1,
    });

    this.addSeparator(page);

    const compositeFolder = page.addFolder({
      title: "Composite Blend",
      expanded: false,
    });

    this.addGraphWithValue(
      compositeFolder,
      statistics,
      "compositeWaterCoveragePct",
      {
        label: "Water Contribution [%]",
        format: (v) => fmt(v, 1),
        min: 0,
        max: 100,
      },
    );

    this.addGraphWithValue(
      compositeFolder,
      statistics,
      "compositeSedimentCoveragePct",
      {
        label: "Sediment Contribution [%]",
        format: (v) => fmt(v, 1),
        min: 0,
        max: 100,
      },
    );

    this.addGraphWithValue(
      compositeFolder,
      statistics,
      "compositeFlatCoveragePct",
      {
        label: "Flat Contribution [%]",
        format: (v) => fmt(v, 1),
        min: 0,
        max: 100,
      },
    );

    this.addGraphWithValue(
      compositeFolder,
      statistics,
      "compositeSteepCoveragePct",
      {
        label: "Steep Contribution [%]",
        format: (v) => fmt(v, 1),
        min: 0,
        max: 100,
      },
    );

    this.addGraphWithValue(
      compositeFolder,
      statistics,
      "compositeMeanSlopeWeight",
      {
        label: "Mean Slope Weight [index]",
        format: (v) => fmt(v, 3),
        min: 0,
        max: 1,
      },
    );

    this.addGraphWithValue(
      compositeFolder,
      statistics,
      "compositeMeanSedimentAlpha",
      {
        label: "Mean Sediment Alpha [index]",
        format: (v) => fmt(v, 3),
        min: 0,
        max: 1,
      },
    );

    this.addGraphWithValue(
      compositeFolder,
      statistics,
      "compositeMeanWaterAlpha",
      {
        label: "Mean Water Alpha [index]",
        format: (v) => fmt(v, 3),
        min: 0,
        max: 1,
      },
    );
  }

  createMediaTab(page) {
    const { media, params } = this;

    const imp = page.addFolder({ title: "Import Data" });
    imp
      .addButton({
        title: this.withHint(
          "Import Heightmap (PNG)",
          "importHeightmap",
          "Ctrl+Shift+U",
        ),
      })
      .on("click", () => media.openImportDialog());
    imp
      .addButton({
        title: this.withHint(
          "Import Parameters (JSON)",
          "importParams",
          "Ctrl+Shift+I",
        ),
      })
      .on("click", () => media.importParamsJSON());
    imp
      .addButton({
        title: this.withHint("Import World (JSON)", "importWorld", "Ctrl+Shift+Q"),
      })
      .on("click", () => media.importWorldJSON());

    this.addSeparator(page);

    const exp = page.addFolder({ title: "Export Data" });
    exp
      .addButton({
        title: this.withHint(
          "Export Parameters (JSON)",
          "exportParams",
          "Ctrl+Shift+P",
        ),
      })
      .on("click", () => media.exportParamsJSON());
    exp
      .addButton({
        title: this.withHint(
          "Export Statistics (JSON)",
          "exportStatistics",
          "Ctrl+Shift+J",
        ),
      })
      .on("click", () => media.exportStatisticsJSON());
    exp
      .addButton({
        title: this.withHint(
          "Export Statistics (CSV)",
          "exportStatisticsCsv",
          "Ctrl+Shift+K",
        ),
      })
      .on("click", () => media.exportStatisticsCSV());
    exp
      .addButton({
        title: this.withHint("Export World (JSON)", "exportWorld", "Ctrl+Shift+W"),
      })
      .on("click", () => media.exportWorldJSON());
    exp
      .addButton({ title: "Export Heightmap (PNG)" })
      .on("click", () => media.exportHeightmapPNG());

    this.addSeparator(exp);

    const capture = exp.addFolder({ title: "Media Capture" });

    capture.addBinding(
      params,
      "recordingFPS",
      this.bindingOptionsFor("recordingFPS", { label: "Recording FPS [Hz]" }),
    );

    capture.addBinding(
      params,
      "videoBitrateMbps",
      this.bindingOptionsFor("videoBitrateMbps", {
        label: "Video Bitrate [Mbps]",
      }),
    );

    const btn = capture.addButton({
      title: media.isRecording
        ? this.withHint("⏹ Stop Recording", "record", "Ctrl+R")
        : this.withHint("⏺ Start Recording", "record", "Ctrl+R"),
    });
    this.recordButton = btn;

    btn.on("click", () => {
      if (media.isRecording) {
        media.stopRecording();
      } else {
        media.startRecording();
      }

      this.syncMediaControls();
    });

    this.addSeparator(capture);

    capture.addBinding(params, "imageFormat", {
      label: "Format",
      options: { PNG: "png", JPG: "jpg", WebP: "webp" },
    });

    capture
      .addButton({
        title: this.withHint("Export Image", "exportImage", "Ctrl+S"),
      })
      .on("click", () => media.exportImage());
  }

  syncMediaControls() {
    if (this.recordButton) {
      this.recordButton.title = this.media.isRecording
        ? this.withHint("⏹ Stop Recording", "record", "Ctrl+R")
        : this.withHint("⏺ Start Recording", "record", "Ctrl+R");
    }
  }

  dispose() {
    this._disposed = true;
    this.recordButton = null;

    if (this.pane && typeof this.pane.dispose === "function") {
      this.pane.dispose();
    }

    this.pane = null;
  }
}

export { GUI };
