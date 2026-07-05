import { ParamStore } from "../../../_shared/utils/ParamStore.js";
import { safePostMessage } from "../../../_shared/utils/WorkerMessaging.js";
import { ColourMapLUT } from "../../../_shared/utils/ColourMapLUT.js";
import { PSI_SCHEMA } from "./ParamSchema.js";
import { Analyser } from "../analysis/Analyser.js";
import { Renderer } from "../render/Renderer.js";
import { Media } from "../media/Media.js";
import { GUI } from "../ui/GUI.js";
import { InputHandler } from "../input/InputHandler.js";

class AppCore {
  static QUANTUM_LIMITS = Object.freeze({ minN: 1, maxN: 12 });
  static ALLOWED_SLICE_PLANES = Object.freeze(["xy", "xz", "yz"]);

  /**
   * @param {{metadata: Object, colourMaps: Object, font: *}} assets
   * @param {import("p5")} p - The p5 instance (instance-mode; no p5 globals).
   */
  constructor(assets, p) {
    const { metadata, colourMaps, font } = assets;
    this.p = p;
    this.metadata = metadata;
    this.font = font;
    this.colourMaps = colourMaps || {};
    this.colourMapKeys = Object.keys(this.colourMaps);
    if (this.colourMapKeys.length === 0) {
      this.colourMaps = { greyscale: ColourMapLUT.GREYSCALE };
      this.colourMapKeys = ["greyscale"];
    }

    // --- Parameter store: single source of truth for every persistent param ---
    this.store = new ParamStore(PSI_SCHEMA, {
      dynamicOptions: { colourMap: this.colourMapKeys },
    });
    const defaultMap = this.colourMapKeys.includes("rocket")
      ? "rocket"
      : this.colourMapKeys[0];
    this.store.set("colourMap", defaultMap);

    // Bindable proxy over the store. Tweakpane binds against `params.<key>` and
    // `params.viewCentre.{x,y,z}`; reads/writes route through store.get/set so
    // the store stays the single place any param value changes.
    this.params = this._buildParamsProxy();

    // Shared, mutable read-model. `aMuMeters` (reduced Bohr radius from the
    // worker) and `orbitalNotation` (derived n/l/m display string) live here so
    // store-only consumers (the Renderer facade) can read them without a
    // back-reference into AppCore.
    this.statistics = {
      fps: 0,
      peakDensity: 0,
      mean: 0,
      stdDev: 0,
      entropy: 0,
      concentration: 0,
      radialPeak: 0,
      radialSpread: 0,
      nodeEstimate: 0,
      aMuMeters: 5.29177210903e-11,
      orbitalNotation: "",
    };

    this._renderQueued = false;
    this._analysisConfig = { resolution: 384 };
    this._analysisSignature = "";
    this._normalisationPeak = 1e-30;
    this._lastStableNormalisationPeak = 1e-30;
    this._canonicalViewRadiusCache = { n: -1, l: -1, Z: -1, value: 45 };

    this.analyser = new Analyser(this.statistics);
    this.renderer = new Renderer(this._buildRendererFacade());
    this.media = new Media(this._buildMediaFacade());
    this.gui = new GUI(this._buildGuiFacade());
    this.input = new InputHandler(this._buildInputFacade());

    this._worker = null;
    this._workerBusy = false;
    this._renderPending = false;
    this._renderRequestId = 0;
    this._gridRecycleBuffer = null;

    this._initWorker();
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Parameter access
  // ---------------------------------------------------------------------------

  /**
   * Build the live-binding proxy over the store. Scalar params pass straight
   * through to store.get/set; `viewCentre` is re-exposed as a nested
   * `{x, y, z}` object (backed by the flat `viewCentre.*` store keys) so binding
   * targets and JSON import/export see it as one object.
   *
   * @returns {Object}
   */
  _buildParamsProxy() {
    const store = this.store;
    const scalarKeys = Object.keys(PSI_SCHEMA).filter((k) => !k.includes("."));
    const viewCentre = store.asObject("viewCentre", ["x", "y", "z"]);
    return new Proxy(
      {},
      {
        get(_t, key) {
          if (key === "viewCentre") return viewCentre;
          if (typeof key === "string" && PSI_SCHEMA[key]) return store.get(key);
          return undefined;
        },
        set(_t, key, value) {
          if (key === "viewCentre") {
            if (value && typeof value === "object") {
              if ("x" in value) viewCentre.x = value.x;
              if ("y" in value) viewCentre.y = value.y;
              if ("z" in value) viewCentre.z = value.z;
            }
            return true;
          }
          if (typeof key === "string" && PSI_SCHEMA[key]) {
            store.set(key, value);
          }
          return true;
        },
        has(_t, key) {
          return (
            key === "viewCentre" ||
            (typeof key === "string" && Boolean(PSI_SCHEMA[key]))
          );
        },
        ownKeys() {
          return [...scalarKeys, "viewCentre"];
        },
        getOwnPropertyDescriptor(_t, key) {
          if (
            key === "viewCentre" ||
            (typeof key === "string" && PSI_SCHEMA[key])
          ) {
            return { configurable: true, enumerable: true, writable: true };
          }
          return undefined;
        },
      },
    );
  }

  /**
   * A plain snapshot of every param with `viewCentre` re-nested — handed to the
   * worker and used to build the render/analysis messages.
   *
   * @returns {Object}
   */
  _snapshotParams() {
    const snap = this.store.snapshot();
    return {
      ...snap,
      viewCentre: {
        x: snap["viewCentre.x"],
        y: snap["viewCentre.y"],
        z: snap["viewCentre.z"],
      },
    };
  }

  /**
   * Re-apply store coercion/clamping to every param in dependency order so a
   * relative bound (e.g. `sliceOffset` vs `viewRadius`) is re-resolved after its
   * referent changed. Schema insertion order guarantees referents are set first.
   */
  _sanitiseParams() {
    const snap = this.store.snapshot();
    for (const key of Object.keys(snap)) {
      this.store.set(key, snap[key]);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-consumer facades — each module gets exactly what it needs, never a
  // back-reference to AppCore. Metadata is exposed via a getter so a
  // Media-driven reassignment (JSON import) stays visible to every consumer.
  // ---------------------------------------------------------------------------

  _buildRendererFacade() {
    const core = this;
    return {
      store: this.store,
      statistics: this.statistics,
      analyser: this.analyser,
      colourMaps: this.colourMaps,
      get metadata() {
        return core.metadata;
      },
      getPlaneAxes: () => this.getPlaneAxes(),
      getNormalisationPeak: () => this.getNormalisationPeak(),
      p: this.p,
    };
  }

  _buildGuiFacade() {
    const core = this;
    return {
      store: this.store,
      params: this.params,
      statistics: this.statistics,
      colourMaps: this.colourMaps,
      media: this.media,
      get metadata() {
        return core.metadata;
      },
      requestRender: () => this.requestRender(),
      syncViewConstraints: () => this.syncViewConstraints(),
      resetViewRadius: () => this.resetViewRadius(),
      resetSliceOffset: () => this.resetSliceOffset(),
      resetViewCentre: () => this.resetViewCentre(),
    };
  }

  _buildInputFacade() {
    const core = this;
    return {
      store: this.store,
      params: this.params,
      statistics: this.statistics,
      colourMaps: this.colourMaps,
      media: this.media,
      p: this.p,
      get metadata() {
        return core.metadata;
      },
      requestRender: () => this.requestRender(),
      refreshGUI: () => this.refreshGUI(),
      syncViewConstraints: () => this.syncViewConstraints(),
      resetViewRadius: () => this.resetViewRadius(),
      resetSliceOffset: () => this.resetSliceOffset(),
      resetViewCentre: () => this.resetViewCentre(),
      getPlaneAxes: () => this.getPlaneAxes(),
      canvasInteraction: (event) => this.canvasInteraction(event),
      updateQuantumNumbers: (type, delta) =>
        this.updateQuantumNumbers(type, delta),
      adjustLogAlpha: (delta) => this.adjustLogAlpha(delta),
      changePlane: (plane) => this.changePlane(plane),
      cycleColourMap: () => this.cycleColourMap(),
      toggleOverlay: () => this.toggleOverlay(),
      toggleNodeOverlay: () => this.toggleNodeOverlay(),
      toggleLegend: () => this.toggleLegend(),
      toggleSmoothing: () => this.toggleSmoothing(),
      toggleGUI: () => this.toggleGUI(),
      toggleKeymapRef: () => this.toggleKeymapRef(),
      exportImage: () => this.exportImage(),
    };
  }

  _buildMediaFacade() {
    const core = this;
    return {
      store: this.store,
      params: this.params,
      statistics: this.statistics,
      analyser: this.analyser,
      get metadata() {
        return core.metadata;
      },
      set metadata(value) {
        core.metadata = value;
      },
      refreshGUI: () => this.refreshGUI(),
      enforceConstraints: () => this.gui.enforceConstraints(),
      syncViewConstraints: () => this.syncViewConstraints(),
      sanitiseParams: () => this._sanitiseParams(),
    };
  }

  // ---------------------------------------------------------------------------
  // Loop hooks
  // ---------------------------------------------------------------------------

  update() {
    this.input.handleContinuousInput();
    this.statistics.fps = this.p.frameRate();
  }

  render() {
    this.renderer.render();
    if (this._renderQueued) {
      this._renderQueued = false;
      this._requestRenderNow();
    }
  }

  // ---------------------------------------------------------------------------
  // Parameter mutators (all route through the store)
  // ---------------------------------------------------------------------------

  updateQuantumNumbers(type, delta) {
    if (type === "n" || type === "l" || type === "m") {
      this.store.set(type, this.store.get(type) + delta);
    }
    this.gui.enforceConstraints();
  }

  changePlane(plane) {
    if (AppCore.ALLOWED_SLICE_PLANES.includes(plane)) {
      this.store.set("slicePlane", plane);
      this.refreshGUI();
      this.requestRender();
    }
  }

  cycleColourMap() {
    const maps = this.colourMapKeys;
    const index = maps.indexOf(this.store.get("colourMap"));
    this.store.set("colourMap", maps[(index + 1) % maps.length]);
    this.refreshGUI();
    this.requestRender();
  }

  toggleOverlay() {
    this.store.set("renderOverlay", !this.store.get("renderOverlay"));
    this.requestRender();
  }

  toggleNodeOverlay() {
    this.store.set("renderNodeOverlay", !this.store.get("renderNodeOverlay"));
    this.requestRender();
  }

  toggleLegend() {
    this.store.set("renderLegend", !this.store.get("renderLegend"));
    this.requestRender();
  }

  toggleSmoothing() {
    this.store.set("pixelSmoothing", !this.store.get("pixelSmoothing"));
    this.requestRender();
  }

  toggleGUI() {
    this.gui.pane.expanded = !this.gui.pane.expanded;
  }

  toggleKeymapRef() {
    this.store.set("renderKeymapRef", !this.store.get("renderKeymapRef"));
    this.requestRender();
  }

  resetViewRadius() {
    this.store.set("viewRadius", PSI_SCHEMA.viewRadius.default);
    this.refreshGUI();
    this.requestRender();
  }

  resetSliceOffset() {
    this.store.set("sliceOffset", PSI_SCHEMA.sliceOffset.default);
    this.refreshGUI();
    this.requestRender();
  }

  resetViewCentre() {
    this.store.set("viewCentre.x", 0);
    this.store.set("viewCentre.y", 0);
    this.store.set("viewCentre.z", 0);
    this.refreshGUI();
    this.requestRender();
  }

  adjustSliceOffset(delta) {
    this.store.set("sliceOffset", this.store.get("sliceOffset") + delta);
    this.refreshGUI();
    this.requestRender();
  }

  adjustViewRadius(delta) {
    this.store.set("viewRadius", this.store.get("viewRadius") + delta);
    this.refreshGUI();
    this.syncViewConstraints();
  }

  adjustResolution(delta) {
    this.store.set("resolution", this.store.get("resolution") + delta);
    this.refreshGUI();
    this.requestRender();
  }

  adjustLogAlpha(delta) {
    this.store.set("logAlpha", this.store.get("logAlpha") + delta);
    this.refreshGUI();
    this.requestRender();
  }

  exportImage() {
    this.media.exportImage();
  }

  resize() {
    const canvasSize = this.p.min(this.p.windowWidth, this.p.windowHeight);
    this.p.resizeCanvas(canvasSize, canvasSize);
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Input delegation
  // ---------------------------------------------------------------------------

  handleWheel(event) {
    return this.input.handleWheel(event);
  }

  handlePointer(event) {
    return this.input.handlePointer(event);
  }

  handlePointerEnd(event) {
    return this.input.handlePointerEnd(event);
  }

  handleKeyPressed(k, kCode, event = null) {
    return KeyboardUtils.safeHandle("Psi", "press", () =>
      this.input.handleKeyPressed(k, kCode, event),
    );
  }

  handleKeyReleased(k, kCode, event = null) {
    return KeyboardUtils.safeHandle("Psi", "release", () =>
      this.input.handleKeyReleased(k, kCode, event),
    );
  }

  canvasInteraction(event) {
    if (!event || !event.target) return false;
    if (typeof event.target.closest !== "function") return false;
    if (event.target.closest(".tp-dfwv")) return false;
    if (event.target.tagName !== "CANVAS") return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------

  getPlaneAxes() {
    switch (this.store.get("slicePlane")) {
      case "xy":
        return { axis1: "x", axis2: "y", fixedAxis: "z", axis1Label: "X", axis2Label: "Y", fixedLabel: "Z" };
      case "yz":
        return { axis1: "y", axis2: "z", fixedAxis: "x", axis1Label: "Y", axis2Label: "Z", fixedLabel: "X" };
      case "xz":
      default:
        return { axis1: "x", axis2: "z", fixedAxis: "y", axis1Label: "X", axis2Label: "Z", fixedLabel: "Y" };
    }
  }

  // ---------------------------------------------------------------------------
  // Render scheduling
  // ---------------------------------------------------------------------------

  requestRender() {
    this._renderQueued = true;
  }

  _requestRenderNow() {
    if (!this._worker) return;
    if (this._workerBusy) {
      this._renderPending = true;
    } else {
      this._dispatchRender();
    }
  }

  // ---------------------------------------------------------------------------
  // Physics helpers
  // ---------------------------------------------------------------------------

  _getCanonicalViewRadius() {
    const n = Math.max(1, Number(this.store.get("n")) || 1);
    const l = Math.max(0, Number(this.store.get("l")) || 0);
    const Z = Math.max(1, Number(this.store.get("nuclearCharge")) || 1);
    const cache = this._canonicalViewRadiusCache;
    if (cache.n === n && cache.l === l && cache.Z === Z) return cache.value;
    const lHalf = l + 0.5;
    const ratio = lHalf / n;
    const outerRadius = ((n * n) / Z) * (1 + Math.sqrt(Math.max(0, 1 - ratio * ratio)));
    const value = Math.max(8, Math.min(512, outerRadius * 1.15));
    this._canonicalViewRadiusCache = { n, l, Z, value };
    return value;
  }

  _getAnalysisSignature() {
    const snap = this.store.snapshot();
    const Z = Math.max(1, Math.round(Number(snap.nuclearCharge) || 1));
    const urm = snap.useReducedMass !== false;
    return [
      snap.n,
      snap.l,
      snap.m,
      snap.slicePlane,
      Number(snap.sliceOffset).toFixed(6),
      Z,
      urm ? 1 : 0,
      Number(snap.nucleusMassKg || 0).toPrecision(8),
    ].join("|");
  }

  getNormalisationPeak() {
    const peak = Number(this._normalisationPeak);
    if (Number.isFinite(peak) && peak > 0) return peak;
    return Math.max(1e-30, Number(this._lastStableNormalisationPeak) || 1e-30);
  }

  // ---------------------------------------------------------------------------
  // Worker communication
  // ---------------------------------------------------------------------------

  _postWorkerMessage(msg, transfers = [], context = "worker request") {
    if (!this._worker) return false;
    return safePostMessage(this._worker, msg, transfers, context);
  }

  _handleWorkerFailure(reason, detail = null) {
    console.error(`[Psi] Worker ${reason}`, detail);
    this._workerBusy = false;
    this._renderPending = false;
    this._gridRecycleBuffer = null;
  }

  _initWorker() {
    try {
      this._worker = new Worker(
        new URL("../worker/PsiWorker.js", import.meta.url),
        { type: "module" },
      );
    } catch (error) {
      throw new Error("[Psi] Worker is required but could not be created.");
    }
    this._worker.onmessage = (e) => this._onWorkerMessage(e.data);
    this._worker.onerror = (e) => this._handleWorkerFailure("runtime error", e);
    this._worker.onmessageerror = (e) =>
      this._handleWorkerFailure("message deserialisation error", e);
  }

  _takeGridRecycleTransfer(clear = true) {
    if (!this._gridRecycleBuffer) return [];
    const transfer = [this._gridRecycleBuffer];
    if (clear) this._gridRecycleBuffer = null;
    return transfer;
  }

  _dispatchRender() {
    this._sanitiseParams();
    const snap = this._snapshotParams();
    const analysisSignature = this._getAnalysisSignature();
    const includeAnalysis =
      (snap.renderOverlay || snap.renderNodeOverlay) &&
      analysisSignature !== this._analysisSignature;
    const analysisViewRadius = this._getCanonicalViewRadius();
    const requestId = ++this._renderRequestId;
    this._workerBusy = true;
    this._renderPending = false;
    const msg = {
      type: "render",
      requestId,
      n: snap.n,
      l: snap.l,
      m: snap.m,
      nuclearCharge: Math.max(1, Math.round(Number(snap.nuclearCharge) || 1)),
      useReducedMass: snap.useReducedMass !== false,
      nucleusMassKg: Number(snap.nucleusMassKg) || snap.nucleusMassKg,
      res: snap.resolution,
      viewRadius: snap.viewRadius,
      slicePlane: snap.slicePlane,
      sliceOffset: snap.sliceOffset,
      viewCentre: { ...snap.viewCentre },
      includeAnalysis,
      analysisSignature,
      analysisResolution: this._analysisConfig.resolution,
      analysisViewRadius,
      reuseGridBuffer:
        this._gridRecycleBuffer instanceof ArrayBuffer
          ? this._gridRecycleBuffer
          : null,
    };
    const transfers = this._takeGridRecycleTransfer(false);
    const posted = this._postWorkerMessage(msg, transfers, "render dispatch");
    if (!posted) {
      this._workerBusy = false;
      this._renderPending = true;
      return;
    }
    if (transfers.length > 0) this._gridRecycleBuffer = null;
  }

  _applyWorkerAnalysis(data) {
    const nextPeak = Number(data.analysisPeak);
    if (Number.isFinite(nextPeak) && nextPeak > 0) {
      this._normalisationPeak = Math.max(1e-30, nextPeak);
      this._lastStableNormalisationPeak = this._normalisationPeak;
    } else {
      this._normalisationPeak = this._lastStableNormalisationPeak;
    }
    const workerAMu = Number(data.analysisAMu);
    if (Number.isFinite(workerAMu) && workerAMu > 0) {
      this.statistics.aMuMeters = workerAMu;
    }
    if (typeof data.analysisSignature === "string" && data.analysisSignature) {
      this._analysisSignature = data.analysisSignature;
    }
    const snap = this._snapshotParams();
    if ((!snap.renderOverlay && !snap.renderNodeOverlay) || !data.analysisStatistics) {
      return;
    }
    this.analyser.applyWorkerStatistics(data.analysisStatistics, {
      ...snap,
      fps: Number(this.statistics.fps) || 0,
      resolution: Number(data.analysisResolution) || this._analysisConfig.resolution,
      viewRadius: Number(data.analysisViewRadius) || this._getCanonicalViewRadius(),
      viewCentre: { x: 0, y: 0, z: 0 },
      aMuMeters: this.statistics.aMuMeters,
    });
  }

  _onWorkerMessage(data) {
    if (data && typeof data === "object" && data.type === "workerError") {
      const stage =
        typeof data.stage === "string" && data.stage ? data.stage : "unknown stage";
      const message =
        typeof data.message === "string" && data.message
          ? data.message
          : "unknown worker failure";
      this._handleWorkerFailure(
        `reported failure during ${stage}: ${message}`,
        data,
      );
      return;
    }
    if (!data || typeof data !== "object" || data.type !== "result") {
      this._workerBusy = false;
      return;
    }
    if (Number(data.requestId) !== this._renderRequestId) return;
    if (!(data.grid instanceof ArrayBuffer)) {
      this._workerBusy = false;
      return;
    }
    const res = this.store.get("resolution");
    const safeRes = Math.max(
      64,
      Math.min(512, Math.round(Number(data.resolution) || res)),
    );
    if (data.grid.byteLength !== safeRes * safeRes * Float32Array.BYTES_PER_ELEMENT) {
      this._workerBusy = false;
      return;
    }
    const safePeak = Number(data.peak);
    this._workerBusy = false;
    this._applyWorkerAnalysis(data);
    this.renderer.renderFromGrid(
      data.grid,
      Number.isFinite(safePeak) && safePeak > 0 ? safePeak : 1e-30,
      safeRes,
    );
    this._gridRecycleBuffer = data.grid;
    if (this._renderPending) {
      this._renderPending = false;
      this._dispatchRender();
    }
  }

  // ---------------------------------------------------------------------------
  // GUI helpers
  // ---------------------------------------------------------------------------

  syncViewConstraints() {
    if (this.gui && typeof this.gui.updateViewConstraints === "function") {
      this.gui.updateViewConstraints();
      return;
    }
    this.requestRender();
  }

  refreshGUI() {
    if (this.gui && typeof this.gui.refresh === "function") this.gui.refresh();
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose() {
    if (this._worker) {
      this._worker.onmessage = null;
      this._worker.onerror = null;
      this._worker.onmessageerror = null;
      this._worker.terminate();
      this._worker = null;
    }
    this._workerBusy = false;
    this._renderPending = false;
    this._renderRequestId = 0;
    this._gridRecycleBuffer = null;
    this._renderQueued = false;
    if (this.media && typeof this.media.dispose === "function") this.media.dispose();
    if (this.renderer && typeof this.renderer.dispose === "function") this.renderer.dispose();
    if (this.gui && typeof this.gui.dispose === "function") this.gui.dispose();
  }
}

export { AppCore };
