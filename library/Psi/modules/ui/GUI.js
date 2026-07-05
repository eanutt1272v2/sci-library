import { scheduleFrameFriendlyTask } from "../../../_shared/utils/FrameScheduler.js";
import { FormatUtils } from "../../../_shared/utils/FormatUtils.js";
import { PSI_SCHEMA } from "../core/ParamSchema.js";

class GUI {
  /**
   * @param {Object} facade - GUI's view of AppCore: `{store, params, statistics,
   *   colourMaps, media, metadata, requestRender, syncViewConstraints,
   *   resetViewRadius, resetSliceOffset, resetViewCentre}`.
   */
  constructor(facade) {
    this.facade = facade;
    this.store = facade.store;
    this.params = facade.params;
    this.statistics = facade.statistics;
    this.colourMaps = facade.colourMaps;
    this.media = facade.media;

    this.bindings = {};
    this.massControl = { nucleusMassLog10: -27 };
    this.recordButton = null;
    this._tabsReady = false;
    this._disposed = false;
    this.pane = new Tweakpane.Pane({
      title: `${facade.metadata.name} ${facade.metadata.version} by ${facade.metadata.author}`,
      expanded: true,
    });

    const buildTabs = () => {
      if (this._disposed) return;
      if (this._tabsReady) return;
      this._tabsReady = true;
      this.setupTabs();
    };

    scheduleFrameFriendlyTask(buildTabs, {
      label: "Psi GUI bootstrap",
      timeoutMs: 240,
      useIdle: true,
    });
  }

  /**
   * Slider binding options for a numeric schema key: the store's live-resolved
   * range plus the schema's `step`, merged with any per-call extras (label,
   * format). This is the single place a slider's bounds come from — no hardcoded
   * numeric literals in the `addBinding` calls.
   *
   * @param {string} key
   * @param {Object} [extra]
   * @returns {Object}
   */
  bindingOptionsFor(key, extra = {}) {
    const range = this.store.getRange(key);
    const options = { ...extra };
    if (typeof range.min === "number") options.min = range.min;
    if (typeof range.max === "number") options.max = range.max;
    const step = PSI_SCHEMA[key] && PSI_SCHEMA[key].step;
    if (typeof step === "number") options.step = step;
    return options;
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
      "g", "h", "i", "k", "l", "m", "n", "o", "q",
      "r", "t", "u", "v", "w", "x", "y", "z",
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

    perf.addBinding(this.statistics, "fps", {
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

    quantum.addBinding(this.statistics, "orbitalNotation", {
      label: "Orbital Notation",
      readonly: true,
    });

    this.bindings.n = quantum.addBinding(
      this.params,
      "n",
      this.bindingOptionsFor("n", {
        label: this.withHint("Principal n", "quantumN", "W/S"),
      }),
    );

    this.bindings.l = quantum.addBinding(
      this.params,
      "l",
      this.bindingOptionsFor("l", {
        label: this.withHint("Angular l", "quantumL", "D/A"),
      }),
    );

    this.bindings.m = quantum.addBinding(
      this.params,
      "m",
      this.bindingOptionsFor("m", {
        label: this.withHint("Magnetic m", "quantumM", "E/Q"),
      }),
    );

    this.bindings.nuclearCharge = quantum
      .addBinding(
        this.params,
        "nuclearCharge",
        this.bindingOptionsFor("nuclearCharge", {
          label: this.withHint("Nuclear Charge Z", "nuclearCharge", "R/T"),
          format: (v) =>
            String(Math.max(1, Math.min(20, Math.round(Number(v) || 1)))),
        }),
      )
      .on("change", (ev) => {
        const z = Math.max(1, Math.min(20, Math.round(Number(ev.value) || 1)));
        if (this.params.nuclearCharge !== z) {
          this.params.nuclearCharge = z;
          this.pane.refresh();
        }
        this.facade.requestRender();
      });

    quantum
      .addBinding(this.params, "useReducedMass", {
        label: this.withHint("Toggle Reduced Mass", "reducedMass", "P"),
      })
      .on("change", () => {
        this.facade.requestRender();
      });

    this.syncMassControlFromParams();

    this.bindings.nucleusMassLog10 = quantum
      .addBinding(this.massControl, "nucleusMassLog10", {
        label: this.withHint("log₁₀ Nucleus Mass", "nucleusMass", "G/B"),
        min: -30,
        max: -24,
        step: 0.01,
        format: (v) => Number(v).toFixed(2),
      })
      .on("change", (ev) => {
        const value = Number(ev.value);
        if (!Number.isFinite(value)) return;

        this.params.nucleusMassKg = Math.pow(10, value);
        this.facade.requestRender();
      });

    quantum.addBinding(this.params, "nucleusMassKg", {
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
    const colourMapOptions = Object.keys(this.colourMaps).reduce((obj, name) => {
      const entry = this.colourMaps[name] || {};
      const type = entry.type || "sequential";
      obj[`${name} (${type})`] = name;
      return obj;
    }, {});

    const appearance = page.addFolder({ title: "Appearance", expanded: true });

    appearance
      .addBinding(this.params, "colourMap", {
        label: this.withHint("Selected Colour Map", "colourMap", "C"),
        options: colourMapOptions,
      })
      .on("change", () => this.facade.requestRender());

    appearance
      .addBinding(
        this.params,
        "logAlpha",
        this.bindingOptionsFor("logAlpha", {
          label: this.withHint("Log-γ Alpha α", "logAlpha", "[/]"),
          format: (v) => Number(v).toFixed(0),
        }),
      )
      .on("change", () => this.facade.requestRender());

    this.addSeparator(page);

    const quality = page.addFolder({ title: "Sampling", expanded: true });

    quality
      .addBinding(
        this.params,
        "resolution",
        this.bindingOptionsFor("resolution", {
          label: this.withHint("Resolution", "resolution", "+/-"),
        }),
      )
      .on("change", () => this.facade.requestRender());

    quality
      .addBinding(this.params, "pixelSmoothing", {
        label: this.withHint("Smoothing", "smoothing", "M"),
      })
      .on("change", () => this.facade.requestRender());

    this.addSeparator(page);

    const overlay = page.addFolder({
      title: "Visual Overlays",
      expanded: true,
    });

    overlay
      .addBinding(this.params, "renderLegend", {
        label: this.withHint("Toggle Legend", "legend", "L"),
      })
      .on("change", () => this.facade.requestRender());

    overlay
      .addBinding(this.params, "renderNodeOverlay", {
        label: this.withHint("Toggle Detected Nodes Overlay", "nodeOverlay", "N"),
      })
      .on("change", () => this.facade.requestRender());

    this.addSeparator(page);

    const slice = page.addFolder({ title: "Slice View", expanded: true });

    this.bindings.viewRadius = slice.addBinding(
      this.params,
      "viewRadius",
      this.bindingOptionsFor("viewRadius", {
        label: this.withHint("View Radius [a₀]", "viewRadius", "I/K"),
      }),
    );

    slice
      .addButton({
        title: this.withHint("Reset View Radius", "resetViewRadius", "Z"),
      })
      .on("click", () => this.facade.resetViewRadius());

    slice
      .addBinding(this.params, "slicePlane", {
        label: this.withHint("Selected Slice Plane", "slicePlane", "1/2/3"),
        options: {
          "XY Plane (Slice Z)": "xy",
          "XZ Plane (Slice Y)": "xz",
          "YZ Plane (Slice X)": "yz",
        },
      })
      .on("change", () => this.facade.requestRender());

    this.bindings.sliceOffset = slice.addBinding(
      this.params,
      "sliceOffset",
      this.bindingOptionsFor("sliceOffset", {
        label: this.withHint("Slice Offset [a₀]", "sliceOffset", "Shift+J/L"),
      }),
    );

    slice
      .addButton({
        title: this.withHint("Reset Slice Offset", "resetSliceOffset", "Space"),
      })
      .on("click", () => this.facade.resetSliceOffset());

    this.bindings.viewRadius.on("change", () => this.updateViewConstraints());
    this.bindings.sliceOffset.on("change", () => this.facade.requestRender());

    this.addSeparator(page);

    const pan = page.addFolder({ title: "View Centre", expanded: true });

    pan
      .addBinding(
        this.params.viewCentre,
        "x",
        this.bindingOptionsFor("viewCentre.x", {
          label: this.withHint("Pan X [a₀]", "panX", "Shift+A/D"),
        }),
      )
      .on("change", () => this.facade.requestRender());

    pan
      .addBinding(
        this.params.viewCentre,
        "y",
        this.bindingOptionsFor("viewCentre.y", {
          label: this.withHint("Pan Y [a₀]", "panY", "Shift+W/S"),
        }),
      )
      .on("change", () => this.facade.requestRender());

    pan
      .addBinding(
        this.params.viewCentre,
        "z",
        this.bindingOptionsFor("viewCentre.z", {
          label: this.withHint("Pan Z [a₀]", "panZ", "Shift+Q/E"),
        }),
      )
      .on("change", () => this.facade.requestRender());

    pan
      .addButton({
        title: this.withHint("Reset View Centre", "resetViewCentre", "X"),
      })
      .on("click", () => this.facade.resetViewCentre());
  }

  createStatisticsTab(page) {
    const statistics = this.statistics;
    const params = this.params;
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
      .on("change", () => this.facade.requestRender());

    this.addSeparator(page);

    const distribution = page.addFolder({
      title: "Distribution",
      expanded: true,
    });

    distribution.addBinding(statistics, "peakDensity", {
      readonly: true,
      label: "Peak Density [m⁻³]",
      format: formatSigned,
    });

    distribution.addBinding(statistics, "mean", {
      readonly: true,
      label: "Mean Density [m⁻³]",
      format: formatSigned,
    });

    distribution.addBinding(statistics, "stdDev", {
      readonly: true,
      label: "Density Std Dev [m⁻³]",
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
      label: "Radial Peak [a₀]",
      format: formatSigned,
    });

    radial.addBinding(statistics, "radialSpread", {
      readonly: true,
      label: "Radial Spread [a₀]",
      format: formatSigned,
    });

    radial.addBinding(statistics, "nodeEstimate", {
      readonly: true,
      label: "Node Estimate",
      format: formatInt,
    });
  }

  createMediaTab(page) {
    const media = this.media;
    const params = this.params;

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

    this.recordButton = capture.addButton({
      title: media.isRecording
        ? this.withHint("⏹ Stop Recording", "record", "Ctrl+R")
        : this.withHint("⏺ Start Recording", "record", "Ctrl+R"),
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
    this.recordButton.title = this.media.isRecording
      ? this.withHint("⏹ Stop Recording", "record", "Ctrl+R")
      : this.withHint("⏺ Start Recording", "record", "Ctrl+R");
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
      this.facade.requestRender();
      return;
    }

    const store = this.store;

    // n / l / m are clamped by the store on every set; here we (a) re-run that
    // clamp so a change to a referent re-clamps its dependents, and (b) push the
    // now-current resolved range onto each slider so the UI matches.
    const nRange = store.getRange("n");
    this.bindings.n.min = nRange.min;
    this.bindings.n.max = nRange.max;
    store.set("n", store.get("n"));

    store.set("l", store.get("l")); // re-clamp against n - 1
    const lRange = store.getRange("l");
    this.bindings.l.min = lRange.min;
    this.bindings.l.max = lRange.max;

    store.set("m", store.get("m")); // re-clamp against ±l
    const mRange = store.getRange("m");
    this.bindings.m.min = mRange.min;
    this.bindings.m.max = mRange.max;

    store.set("nuclearCharge", store.get("nuclearCharge"));

    const orbitalLetter = this.getSpectroscopicLetter(store.get("l"));
    this.statistics.orbitalNotation = `${store.get("n")}${orbitalLetter} (m=${store.get("m")})`;

    this.syncMassControlFromParams();

    this.pane.refresh();
    this.facade.requestRender();
  }

  syncMassControlFromParams() {
    const mass = Number(this.params.nucleusMassKg);
    const fallback = 1.67262192369e-27;
    const safeMass = Number.isFinite(mass) && mass > 0 ? mass : fallback;
    this.params.nucleusMassKg = safeMass;
    this.massControl.nucleusMassLog10 = Math.max(
      -30,
      Math.min(-24, Math.log10(safeMass)),
    );
  }

  updateViewConstraints() {
    if (!this._tabsReady || !this.pane || !this.bindings.sliceOffset) {
      this.facade.requestRender();
      return;
    }

    const store = this.store;

    store.set("sliceOffset", store.get("sliceOffset")); // re-clamp against ±viewRadius
    const range = store.getRange("sliceOffset");
    this.bindings.sliceOffset.min = range.min;
    this.bindings.sliceOffset.max = range.max;

    this.pane.refresh();
    this.facade.requestRender();
  }

  refresh() {
    if (!this._tabsReady || !this.pane) return;

    this.syncMassControlFromParams();
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

export { GUI };
