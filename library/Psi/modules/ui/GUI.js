class GUI {
  constructor(appcore) {
    this.appcore = appcore;

    this.bindings = {};
    this.massControl = { nucleusMassLog10: -27 };
    this.recordButton = null;
    this._tabsReady = false;
    this._disposed = false;
    this.pane = new Tweakpane.Pane({
      title: `${this.appcore.metadata.name} ${this.appcore.metadata.version} by ${this.appcore.metadata.author}`,
      expanded: true,
    });

    const buildTabs = () => {
      if (this._disposed) return;
      if (this._tabsReady) return;
      this._tabsReady = true;
      this.setupTabs();
    };

    if (
      typeof AppDiagnostics !== "undefined" &&
      typeof AppDiagnostics.scheduleFrameFriendlyTask === "function"
    ) {
      AppDiagnostics.scheduleFrameFriendlyTask(buildTabs, {
        logger: this.appcore?._diagnosticsLogger,
        label: "Psi GUI bootstrap",
        timeoutMs: 240,
        useIdle: true,
      });
    } else {
      buildTabs();
    }
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

    this.createSimulationTab(tabs.pages[0]);
    this.createParametersTab(tabs.pages[1]);
    this.createRenderTab(tabs.pages[2]);
    this.createStatisticsTab(tabs.pages[3]);
    this.createMediaTab(tabs.pages[4]);

    this.enforceConstraints();
  }

  addSeparator(target) {
    target.addBlade({ view: "separator" });
  }

  withHint(label, id, fallback = "") {
    if (typeof KeybindCatalogue === "undefined") {
      return fallback ? `${label} (${fallback})` : label;
    }
    return KeybindCatalogue.withHint(label, "psi", id, fallback);
  }

  getSpectroscopicLetter(lValue) {
    const l = Math.max(0, Math.round(Number(lValue) || 0));
    const base = ["s", "p", "d", "f"];
    if (l < base.length) return base[l];

    const extended = [
      "g",
      "h",
      "i",
      "k",
      "l",
      "m",
      "n",
      "o",
      "q",
      "r",
      "t",
      "u",
      "v",
      "w",
      "x",
      "y",
      "z",
    ];
    const offset = l - base.length;
    if (offset < extended.length) return extended[offset];

    return `l${l}`;
  }

  createSimulationTab(page) {
    const perf = page.addFolder({
      title: "Performance Metrics",
      expanded: true,
    });

    perf.addBinding(this.appcore.statistics, "fps", {
      readonly: true,
      label: "FPS [Hz]",
      view: "graph",
      interval: 60,
      min: 0,
      max: 100,
    });

    this.addSeparator(page);

    const keymapShortcut =
      typeof KeybindCatalogue === "undefined"
        ? "#"
        : KeybindCatalogue.getHint("psi", "keymapReference", "#");
    const keymapHint = {
      text: `Press ${keymapShortcut} to open keymap reference`,
    };
    page.addBinding(keymapHint, "text", {
      label: "Hint",
      readonly: true,
    });
  }

  createParametersTab(page) {
    const quantum = page.addFolder({ title: "Quantum State", expanded: true });

    quantum.addBinding(this.appcore.params, "orbitalNotation", {
      label: "Orbital Notation",
      readonly: true,
    });

    this.bindings.n = quantum.addBinding(this.appcore.params, "n", {
      label: this.withHint("Principal n", "quantumN", "W/S"),
      min: AppCore.QUANTUM_LIMITS.minN,
      max: AppCore.QUANTUM_LIMITS.maxN,
      step: 1,
    });

    this.bindings.l = quantum.addBinding(this.appcore.params, "l", {
      label: this.withHint("Angular l", "quantumL", "D/A"),
      min: 0,
      max: 0,
      step: 1,
    });

    this.bindings.m = quantum.addBinding(this.appcore.params, "m", {
      label: this.withHint("Magnetic m", "quantumM", "E/Q"),
      min: 0,
      max: 0,
      step: 1,
    });

    this.bindings.nuclearCharge = quantum
      .addBinding(this.appcore.params, "nuclearCharge", {
        label: this.withHint("Nuclear Charge Z", "nuclearCharge", "R/T"),
        min: 1,
        max: 20,
        step: 1,
        format: (v) =>
          String(Math.max(1, Math.min(20, Math.round(Number(v) || 1)))),
      })
      .on("change", (ev) => {
        const z = Math.max(1, Math.min(20, Math.round(Number(ev.value) || 1)));
        if (this.appcore.params.nuclearCharge !== z) {
          this.appcore.params.nuclearCharge = z;
          this.pane.refresh();
        }
        this.appcore.requestRender();
      });

    quantum
      .addBinding(this.appcore.params, "useReducedMass", {
        label: this.withHint("Toggle Reduced Mass", "reducedMass", "P"),
      })
      .on("change", () => {
        this.appcore.requestRender();
      });

    this.syncMassControlFromParams();

    this.bindings.nucleusMassLog10 = quantum
      .addBinding(this.massControl, "nucleusMassLog10", {
        label: this.withHint("log\u2081\u2080 Nucleus Mass", "nucleusMass", "G/B"),
        min: -30,
        max: -24,
        step: 0.01,
        format: (v) => Number(v).toFixed(2),
      })
      .on("change", (ev) => {
        const value = Number(ev.value);
        if (!Number.isFinite(value)) return;

        this.appcore.params.nucleusMassKg = Math.pow(10, value);
        this.appcore.requestRender();
      });

    quantum.addBinding(this.appcore.params, "nucleusMassKg", {
      label: "Nucleus Mass [kg]",
      readonly: true,
      format: (v) => {
        const numeric = Number(v);
        return Number.isFinite(numeric) && numeric > 0
          ? numeric.toExponential(6)
          : "1.672622e-27";
      },
    });

    this.bindings.n.on("change", () => this.enforceConstraints());
    this.bindings.l.on("change", () => this.enforceConstraints());
    this.bindings.m.on("change", () => this.enforceConstraints());
  }

  createRenderTab(page) {
    const colourMapOptions = Object.keys(this.appcore.colourMaps).reduce(
      (obj, name) => {
        const entry = this.appcore.colourMaps[name] || {};
        const type = entry.type || "sequential";
        obj[`${name} (${type})`] = name;
        return obj;
      },
      {},
    );

    const appearance = page.addFolder({ title: "Appearance", expanded: true });

    appearance
      .addBinding(this.appcore.params, "colourMap", {
        label: this.withHint("Selected Colour Map", "colourMap", "C"),
        options: colourMapOptions,
      })
      .on("change", () => this.appcore.requestRender());

    this.addSeparator(page);

    const quality = page.addFolder({ title: "Sampling", expanded: true });

    quality
      .addBinding(this.appcore.params, "resolution", {
        label: this.withHint("Resolution", "resolution", "+/-"),
        min: 64,
        max: 512,
        step: 2,
      })
      .on("change", () => this.appcore.requestRender());

    quality
      .addBinding(this.appcore.params, "pixelSmoothing", {
        label: this.withHint("Smoothing", "smoothing", "M"),
      })
      .on("change", () => this.appcore.requestRender());

    this.addSeparator(page);

    const overlay = page.addFolder({
      title: "Visual Overlays",
      expanded: true,
    });

    overlay
      .addBinding(this.appcore.params, "renderLegend", {
        label: this.withHint("Toggle Legend", "legend", "L"),
      })
      .on("change", () => this.appcore.requestRender());

    // nodeOverlayAlpha: exposed directly beneath the colour map dropdown,
    // following the same withHint pattern used by every other adjustable
    // render parameter.  The slider range [0, 1] with step 0.01 matches the
    // precision of the keyboard increment (0.05 rounded to 2 d.p.).
    overlay
      .addBinding(this.appcore.params, "nodeOverlayAlpha", {
        label: this.withHint("Node Overlay Opacity", "nodeOverlayAlpha", "F/V"),
        min: 0,
        max: 1,
        step: 0.01,
        format: (v) => Number(v).toFixed(2),
      })
      .on("change", () => this.appcore.requestRender());

    this.addSeparator(page);

    const slice = page.addFolder({ title: "Slice View", expanded: true });

    this.bindings.viewRadius = slice.addBinding(
      this.appcore.params,
      "viewRadius",
      {
        label: this.withHint("View Radius [a\u2080]", "viewRadius", "I/K"),
        min: 1,
        max: 256,
      },
    );

    slice
      .addButton({
        title: this.withHint("Reset View Radius", "resetViewRadius", "Z"),
      })
      .on("click", () => this.appcore.resetViewRadius());

    slice
      .addBinding(this.appcore.params, "slicePlane", {
        label: this.withHint("Selected Slice Plane", "slicePlane", "1/2/3"),
        options: {
          "XY Plane (Slice Z)": "xy",
          "XZ Plane (Slice Y)": "xz",
          "YZ Plane (Slice X)": "yz",
        },
      })
      .on("change", () => this.appcore.requestRender());

    this.bindings.sliceOffset = slice.addBinding(
      this.appcore.params,
      "sliceOffset",
      {
        label: this.withHint("Slice Offset [a\u2080]", "sliceOffset", "Shift+J/L"),
        min: -1024,
        max: 1024,
      },
    );

    slice
      .addButton({
        title: this.withHint("Reset Slice Offset", "resetSliceOffset", "Space"),
      })
      .on("click", () => this.appcore.resetSliceOffset());

    this.bindings.viewRadius.on("change", () => this.updateViewConstraints());
    this.bindings.sliceOffset.on("change", () => this.appcore.requestRender());

    this.addSeparator(page);

    const pan = page.addFolder({ title: "View Centre", expanded: true });

    pan
      .addBinding(this.appcore.params.viewCentre, "x", {
        label: this.withHint("Pan X [a\u2080]", "panX", "Shift+A/D"),
        min: -256,
        max: 256,
        step: 0.1,
      })
      .on("change", () => this.appcore.requestRender());

    pan
      .addBinding(this.appcore.params.viewCentre, "y", {
        label: this.withHint("Pan Y [a\u2080]", "panY", "Shift+W/S"),
        min: -256,
        max: 256,
        step: 0.1,
      })
      .on("change", () => this.appcore.requestRender());

    pan
      .addBinding(this.appcore.params.viewCentre, "z", {
        label: this.withHint("Pan Z [a\u2080]", "panZ", "Shift+Q/E"),
        min: -256,
        max: 256,
        step: 0.1,
      })
      .on("change", () => this.appcore.requestRender());

    pan
      .addButton({
        title: this.withHint("Reset View Centre", "resetViewCentre", "X"),
      })
      .on("click", () => this.appcore.resetViewCentre());
  }

  createStatisticsTab(page) {
    const { statistics, params } = this.appcore;
    const formatSigned = FormatUtils.formatSigned;
    const formatInt = FormatUtils.formatInt;

    const display = page.addFolder({
      title: "Statistics Overlay",
      expanded: true,
    });

    display
      .addBinding(params, "renderOverlay", {
        label: this.withHint("Toggle Statistics Overlay", "overlay", "O"),
      })
      .on("change", () => this.appcore.requestRender());

    display
      .addBinding(params, "renderNodeOverlay", {
        label: this.withHint(
          "Toggle Detected Nodes Overlay",
          "nodeOverlay",
          "N",
        ),
      })
      .on("change", () => this.appcore.requestRender());

    this.addSeparator(page);

    const distribution = page.addFolder({
      title: "Distribution",
      expanded: true,
    });

    distribution.addBinding(statistics, "density", {
      readonly: true,
      label: "Density [m\u207b\u00b3]",
      format: formatSigned,
      interval: 60,
    });

    distribution.addBinding(statistics, "peakDensity", {
      readonly: true,
      label: "Peak Density [m\u207b\u00b3]",
      format: formatSigned,
    });

    distribution.addBinding(statistics, "mean", {
      readonly: true,
      label: "Mean Density [m\u207b\u00b3]",
      format: formatSigned,
    });

    distribution.addBinding(statistics, "stdDev", {
      readonly: true,
      label: "Density Std Dev [m\u207b\u00b3]",
      format: formatSigned,
    });

    distribution.addBinding(statistics, "entropy", {
      readonly: true,
      label: "Entropy",
      format: formatSigned,
    });

    distribution.addBinding(statistics, "concentration", {
      readonly: true,
      label: "Concentration",
      format: formatSigned,
    });

    this.addSeparator(page);

    const radial = page.addFolder({ title: "Radial Profile", expanded: true });

    radial.addBinding(statistics, "radialPeak", {
      readonly: true,
      label: "Radial Peak [a\u2080]",
      format: formatSigned,
    });

    radial.addBinding(statistics, "radialSpread", {
      readonly: true,
      label: "Radial Spread [a\u2080]",
      format: formatSigned,
    });

    radial.addBinding(statistics, "nodeEstimate", {
      readonly: true,
      label: "Node Estimate",
      format: formatInt,
    });
  }

  createMediaTab(page) {
    const { media, params } = this.appcore;

    const imp = page.addFolder({ title: "Import Data" });

    imp
      .addButton({
        title: this.withHint(
          "Import Parameters (JSON)",
          "importParams",
          "Ctrl+Shift+I",
        ),
      })
      .on("click", () => media.importParamsJSON());

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
          "Ctrl+Shift+S",
        ),
      })
      .on("click", () => media.exportStatisticsJSON());
    exp
      .addButton({
        title: this.withHint(
          "Export Statistics (CSV)",
          "exportStatisticsCsv",
          "Ctrl+Shift+C",
        ),
      })
      .on("click", () => media.exportStatisticsCSV());

    this.addSeparator(exp);

    const capture = exp.addFolder({ title: "Media Capture" });

    capture.addBinding(params, "recordingFPS", {
      label: "Recording FPS [Hz]",
      min: 12,
      max: 120,
      step: 1,
    });

    capture.addBinding(params, "videoBitrateMbps", {
      label: "Video Bitrate [Mbps]",
      min: 1,
      max: 64,
      step: 0.5,
    });

    this.recordButton = capture.addButton({
      title: media.isRecording
        ? this.withHint("\u23f9 Stop Recording", "record", "Ctrl+R")
        : this.withHint("\u23fa Start Recording", "record", "Ctrl+R"),
    });

    this.recordButton.on("click", () => {
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
    if (!this.recordButton) return;
    this.recordButton.title = this.appcore.media.isRecording
      ? this.withHint("\u23f9 Stop Recording", "record", "Ctrl+R")
      : this.withHint("\u23fa Start Recording", "record", "Ctrl+R");
  }

  enforceConstraints() {
    if (
      !this._tabsReady ||
      !this.pane ||
      !this.bindings.n ||
      !this.bindings.l ||
      !this.bindings.m
    ) {
      this.syncMassControlFromParams();
      this.appcore.requestRender();
      return;
    }

    const params = this.appcore.params;

    params.n = Math.max(
      AppCore.QUANTUM_LIMITS.minN,
      Math.min(
        AppCore.QUANTUM_LIMITS.maxN,
        Math.round(Number(params.n) || AppCore.QUANTUM_LIMITS.minN),
      ),
    );

    this.bindings.n.min = AppCore.QUANTUM_LIMITS.minN;
    this.bindings.n.max = AppCore.QUANTUM_LIMITS.maxN;

    params.nuclearCharge = Math.max(
      1,
      Math.min(20, Math.round(Number(params.nuclearCharge) || 1)),
    );

    this.bindings.l.max = params.n - 1;

    if (params.l > this.bindings.l.max) params.l = this.bindings.l.max;

    this.bindings.m.min = -params.l;
    this.bindings.m.max = params.l;

    params.m = Math.max(
      this.bindings.m.min,
      Math.min(this.bindings.m.max, params.m),
    );

    const orbitalLetter = this.getSpectroscopicLetter(params.l);
    params.orbitalNotation = `${params.n}${orbitalLetter} (m=${params.m})`;

    this.syncMassControlFromParams();

    this.pane.refresh();
    this.appcore.requestRender();
  }

  syncMassControlFromParams() {
    const mass = Number(this.appcore.params.nucleusMassKg);
    const fallback = 1.67262192369e-27;
    const safeMass = Number.isFinite(mass) && mass > 0 ? mass : fallback;
    this.appcore.params.nucleusMassKg = safeMass;
    this.massControl.nucleusMassLog10 = Math.max(
      -30,
      Math.min(-24, Math.log10(safeMass)),
    );
  }

  updateViewConstraints() {
    if (!this._tabsReady || !this.pane || !this.bindings.sliceOffset) {
      this.appcore.requestRender();
      return;
    }

    const params = this.appcore.params;

    this.bindings.sliceOffset.min = -params.viewRadius;
    this.bindings.sliceOffset.max = params.viewRadius;

    params.sliceOffset = Math.max(
      this.bindings.sliceOffset.min,
      Math.min(this.bindings.sliceOffset.max, params.sliceOffset),
    );

    this.pane.refresh();
    this.appcore.requestRender();
  }

  refresh() {
    if (!this._tabsReady || !this.pane) return;

    this.syncMassControlFromParams();
    this.syncMediaControls();
    this.pane.refresh();
  }

  dispose() {
    this._disposed = true;
    this.recordButton = null;
    this.bindings = {};

    if (this.pane && typeof this.pane.dispose === "function") {
      this.pane.dispose();
    }

    this.pane = null;
  }
}
