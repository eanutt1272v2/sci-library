class AppCore {
  static QUANTUM_LIMITS = Object.freeze({
    minN: 1,
    maxN: 12,
  });

  static ALLOWED_SLICE_PLANES = Object.freeze(["xy", "xz", "yz"]);

  static ALLOWED_IMAGE_FORMATS = Object.freeze(["png", "jpg", "jpeg", "webp"]);

  constructor(assets) {
    const { metadata, colourMaps, font } = assets;

    this.metadata   = metadata;
    this._diagnosticsLogger =
      typeof AppDiagnostics !== "undefined" &&
      typeof AppDiagnostics.resolveLogger === "function"
        ? AppDiagnostics.resolveLogger("Psi")
        : { info() {}, warn() {}, error() {}, debug() {} };
    this.colourMaps    = colourMaps || {};
    this.colourMapKeys = Object.keys(this.colourMaps);

    if (this.colourMapKeys.length === 0) {
      this.colourMaps    = { greyscale: ColourMapLUT.GREYSCALE };
      this.colourMapKeys = ["greyscale"];
    }

    this.params = {
      orbitalNotation: "",
      n:              4,
      l:              1,
      m:              0,
      nuclearCharge:  1,
      useReducedMass: true,
      nucleusMassKg:  1.67262192369e-27,

      colourMap: this.colourMapKeys.includes("rocket")
        ? "rocket"
        : this.colourMapKeys[0],

      // Log-gamma tone-map compression parameter alpha.
      // Normalised display value: u = log(1 + alpha*t) / log(1 + alpha).
      // Larger alpha = more compression of bright regions, lifting dim lobes.
      logAlpha: 200,

      resolution:       256,
      pixelSmoothing:   true,
      renderOverlay:    true,
      renderNodeOverlay: false,
      renderLegend:     true,
      renderKeymapRef:  false,

      viewRadius:  45,
      slicePlane:  "xz",
      sliceOffset: 0,
      viewCentre:  { x: 0, y: 0, z: 0 },

      imageFormat:       "png",
      recordingFPS:      60,
      videoBitrateMbps:  8,
    };

    this.statistics = {
      fps:           0,
      density:       0,
      peakDensity:   0,
      mean:          0,
      stdDev:        0,
      entropy:       0,
      concentration: 0,
      radialPeak:    0,
      radialSpread:  0,
      nodeEstimate:  0,
    };

    this.font = font;

    this._pendingActions              = [];
    this._analysisConfig              = { resolution: 384 };
    this._analysisSignature           = "";
    this._normalisationPeak           = 1e-30;
    this._lastStableNormalisationPeak = 1e-30;
    this.aMuMeters                    = 5.29177210903e-11;

    this.analyser = new Analyser(this.statistics);
    this.renderer = new Renderer(this);
    this.media    = new Media(this);
    this.gui      = new GUI(this);
    this.input    = new InputHandler(this);

    this._worker            = null;
    this._workerBusy        = false;
    this._renderPending     = false;
    this._renderRequestId   = 0;
    this._gridRecycleBuffer = null;
    this._initWorker();

    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // p5 lifecycle hooks
  // ---------------------------------------------------------------------------

  update() {
    this.input.handleContinuousInput();
    this.statistics.fps = frameRate();
  }

  render() {
    this.renderer.render();

    if (this._pendingActions.length > 0) {
      this._runNextAction();
    }
  }

  // ---------------------------------------------------------------------------
  // Quantum state helpers
  // ---------------------------------------------------------------------------

  updateQuantumNumbers(type, delta) {
    if (type === "n") {
      this.params.n = Math.max(
        AppCore.QUANTUM_LIMITS.minN,
        Math.min(AppCore.QUANTUM_LIMITS.maxN, this.params.n + delta),
      );
    } else if (type === "l") {
      this.params.l = Math.max(0, this.params.l + delta);
    } else if (type === "m") {
      this.params.m += delta;
    }

    this.gui.enforceConstraints();
  }

  // ---------------------------------------------------------------------------
  // View / display toggles
  // ---------------------------------------------------------------------------

  changePlane(plane) {
    if (["xy", "xz", "yz"].includes(plane)) {
      this.params.slicePlane = plane;
      this.refreshGUI();
      this.requestRender();
    }
  }

  cycleColourMap() {
    const maps = this.colourMapKeys;
    const currentIndex = maps.indexOf(this.params.colourMap);
    this.params.colourMap = maps[(currentIndex + 1) % maps.length];
    this.refreshGUI();
    this.requestRender();
  }

  toggleOverlay() {
    this.params.renderOverlay = !this.params.renderOverlay;
  }

  toggleNodeOverlay() {
    this.params.renderNodeOverlay = !this.params.renderNodeOverlay;
  }

  toggleLegend() {
    this.params.renderLegend = !this.params.renderLegend;
  }

  toggleSmoothing() {
    this.params.pixelSmoothing = !this.params.pixelSmoothing;
  }

  toggleGUI() {
    this.gui.pane.expanded = !this.gui.pane.expanded;
  }

  toggleKeymapRef() {
    this.params.renderKeymapRef = !this.params.renderKeymapRef;
  }

  // ---------------------------------------------------------------------------
  // View adjustments
  // ---------------------------------------------------------------------------

  resetViewRadius() {
    this.params.viewRadius = 45;
    this.refreshGUI();
    this.requestRender();
  }

  resetSliceOffset() {
    this.params.sliceOffset = 0;
    this.refreshGUI();
    this.requestRender();
  }

  resetViewCentre() {
    const { viewCentre } = this.params;
    viewCentre.x = 0;
    viewCentre.y = 0;
    viewCentre.z = 0;
    this.refreshGUI();
    this.requestRender();
  }

  adjustSliceOffset(delta) {
    this.params.sliceOffset = constrain(
      this.params.sliceOffset + delta,
      -this.params.viewRadius,
      this.params.viewRadius,
    );
    this.refreshGUI();
    this.requestRender();
  }

  adjustViewRadius(delta) {
    this.params.viewRadius = constrain(this.params.viewRadius + delta, 1, 256);
    this.refreshGUI();
    this.syncViewConstraints();
  }

  adjustResolution(delta) {
    this.params.resolution = constrain(this.params.resolution + delta, 64, 512);
    this.refreshGUI();
    this.requestRender();
  }

  // Adjusts the log-gamma normalisation alpha by delta, clamped to [1, 2000].
  adjustLogAlpha(delta) {
    this.params.logAlpha = Math.max(
      1,
      Math.min(2000, Math.round(this.params.logAlpha + delta)),
    );
    this.refreshGUI();
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Media / export
  // ---------------------------------------------------------------------------

  exportImage() {
    this.media.exportImage();
  }

  // ---------------------------------------------------------------------------
  // Canvas / input event proxies
  // ---------------------------------------------------------------------------

  resize() {
    const canvasSize = min(windowWidth, windowHeight);
    resizeCanvas(canvasSize, canvasSize);
    this.requestRender();
  }

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
    switch (this.params.slicePlane) {
      case "xy":
        return {
          axis1: "x", axis2: "y", fixedAxis: "z",
          axis1Label: "X", axis2Label: "Y", fixedLabel: "Z",
        };
      case "yz":
        return {
          axis1: "y", axis2: "z", fixedAxis: "x",
          axis1Label: "Y", axis2Label: "Z", fixedLabel: "X",
        };
      case "xz":
      default:
        return {
          axis1: "x", axis2: "z", fixedAxis: "y",
          axis1Label: "X", axis2Label: "Z", fixedLabel: "Y",
        };
    }
  }

  // ---------------------------------------------------------------------------
  // Render pipeline
  // ---------------------------------------------------------------------------

  requestRender() {
    this._queueAction("render", () => this._requestRenderNow());
  }

  _requestRenderNow() {
    if (!this._worker) return;

    if (this._workerBusy) {
      this._renderPending = true;
    } else {
      this._dispatchRender();
    }
  }

  _getCanonicalViewRadius() {
    const n    = Math.max(1, Number(this.params.n) || 1);
    const l    = Math.max(0, Number(this.params.l) || 0);
    const Z    = Math.max(1, Number(this.params.nuclearCharge) || 1);
    const lHalf  = l + 0.5;
    const ratio  = lHalf / n;
    const outerRadius = (n * n / Z) * (1 + Math.sqrt(Math.max(0, 1 - ratio * ratio)));
    return Math.max(8, Math.min(512, outerRadius * 1.15));
  }

  _getAnalysisSignature() {
    const { n, l, m, slicePlane, sliceOffset } = this.params;
    const nuclearCharge  = Math.max(1, Math.round(Number(this.params.nuclearCharge) || 1));
    const useReducedMass = this.params.useReducedMass !== false;
    const nucleusMassKg  = Number(this.params.nucleusMassKg) || 0;
    return [
      n,
      l,
      m,
      slicePlane,
      Number(sliceOffset).toFixed(6),
      Number(nuclearCharge || 1),
      useReducedMass ? 1 : 0,
      Number(nucleusMassKg || 0).toPrecision(8),
    ].join("|");
  }

  // ---------------------------------------------------------------------------
  // Param sanitisation
  // ---------------------------------------------------------------------------

  _clampNumber(value, min, max, fallback = min) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
  }

  _clampInteger(value, min, max, fallback = min) {
    return Math.round(this._clampNumber(value, min, max, fallback));
  }

  _sanitiseQuantumParams(params) {
    params.n = this._clampInteger(
      params.n,
      AppCore.QUANTUM_LIMITS.minN,
      AppCore.QUANTUM_LIMITS.maxN,
      AppCore.QUANTUM_LIMITS.minN,
    );
    params.l = this._clampInteger(params.l, 0, params.n - 1, 0);
    params.m = this._clampInteger(params.m, -params.l, params.l, 0);
    params.nuclearCharge = this._clampInteger(params.nuclearCharge, 1, 20, 1);
  }

  _sanitiseMassParams(params) {
    const protonMassKg = 1.67262192369e-27;
    params.useReducedMass = params.useReducedMass !== false;

    const fallbackMass =
      params.nuclearCharge === 1
        ? protonMassKg
        : Math.max(protonMassKg, params.nuclearCharge * protonMassKg);

    params.nucleusMassKg = this._clampNumber(
      params.nucleusMassKg,
      1e-33,
      1e-20,
      fallbackMass,
    );
  }

  _sanitiseRenderParams(params) {
    if (!this.colourMapKeys.includes(params.colourMap)) {
      params.colourMap = this.colourMapKeys[0];
    }
    params.logAlpha         = this._clampNumber(params.logAlpha, 1, 2000, 200);
    params.resolution       = this._clampInteger(params.resolution, 64, 512, 256);
    params.pixelSmoothing   = params.pixelSmoothing !== false;
    params.renderOverlay    = params.renderOverlay !== false;
    params.renderNodeOverlay = Boolean(params.renderNodeOverlay);
    params.renderLegend     = params.renderLegend !== false;
    params.renderKeymapRef  = Boolean(params.renderKeymapRef);
  }

  _sanitiseSliceAndViewParams(params) {
    params.viewRadius = this._clampNumber(params.viewRadius, 1, 256, 45);
    if (!AppCore.ALLOWED_SLICE_PLANES.includes(params.slicePlane)) {
      params.slicePlane = "xz";
    }
    params.sliceOffset = this._clampNumber(
      params.sliceOffset,
      -params.viewRadius,
      params.viewRadius,
      0,
    );

    if (!params.viewCentre || typeof params.viewCentre !== "object") {
      params.viewCentre = { x: 0, y: 0, z: 0 };
    }
    params.viewCentre.x = this._clampNumber(params.viewCentre.x, -1024, 1024, 0);
    params.viewCentre.y = this._clampNumber(params.viewCentre.y, -1024, 1024, 0);
    params.viewCentre.z = this._clampNumber(params.viewCentre.z, -1024, 1024, 0);
  }

  _sanitiseExportParams(params) {
    const fmt = String(params.imageFormat || "png").toLowerCase();
    params.imageFormat       = AppCore.ALLOWED_IMAGE_FORMATS.includes(fmt) ? fmt : "png";
    params.recordingFPS      = this._clampInteger(params.recordingFPS, 12, 120, 60);
    params.videoBitrateMbps  = this._clampNumber(params.videoBitrateMbps, 1, 64, 8);
  }

  _sanitiseAnalysisConfig() {
    this._analysisConfig.resolution = this._clampInteger(
      this._analysisConfig.resolution,
      64,
      512,
      384,
    );
  }

  _sanitisePhysicalParams() {
    const { params } = this;
    this._sanitiseQuantumParams(params);
    this._sanitiseMassParams(params);
    this._sanitiseRenderParams(params);
    this._sanitiseSliceAndViewParams(params);
    this._sanitiseExportParams(params);
    this._sanitiseAnalysisConfig();
  }

  // ---------------------------------------------------------------------------
  // Normalisation peak
  // ---------------------------------------------------------------------------

  getNormalisationPeak() {
    const peak = Number(this._normalisationPeak);
    if (Number.isFinite(peak) && peak > 0) return peak;
    return Math.max(1e-30, Number(this._lastStableNormalisationPeak) || 1e-30);
  }

  // ---------------------------------------------------------------------------
  // Action queue
  // ---------------------------------------------------------------------------

  _queueAction(name, handler) {
    if (!Array.isArray(this._pendingActions)) {
      this._pendingActions = [];
    }
    this._pendingActions = this._pendingActions.filter(
      (action) => action.name !== name,
    );
    this._pendingActions.push({ name, handler });
  }

  _runNextAction() {
    const next = this._pendingActions.shift();
    if (!next || typeof next.handler !== "function") return;
    next.handler();
  }

  // ---------------------------------------------------------------------------
  // Worker communication
  // ---------------------------------------------------------------------------

  _postWorkerMessage(msg, transfers = [], context = "worker request") {
    if (!this._worker) return false;

    if (
      typeof AppDiagnostics !== "undefined" &&
      typeof AppDiagnostics.safePostMessage === "function"
    ) {
      return AppDiagnostics.safePostMessage(
        this._worker,
        msg,
        transfers,
        this._diagnosticsLogger,
        context,
      );
    }

    try {
      this._worker.postMessage(msg, transfers);
      return true;
    } catch (error) {
      this._diagnosticsLogger.error(`Failed ${context}`, error);
      return false;
    }
  }

  _handleWorkerFailure(reason, detail = null) {
    this._diagnosticsLogger.error(`Worker ${reason}`, detail);
    this._workerBusy        = false;
    this._renderPending     = false;
    this._gridRecycleBuffer = null;
  }

  _initWorker() {
    try {
      this._worker = new Worker("./modules/worker/PsiWorker.js");
    } catch (e) {
      throw new Error("[Psi] Worker is required but could not be created.");
    }
    this._worker.onmessage      = (e) => this._onWorkerMessage(e.data);
    this._worker.onerror        = (e) => this._handleWorkerFailure("runtime error", e);
    this._worker.onmessageerror = (e) => this._handleWorkerFailure("message deserialisation error", e);
  }

  _takeGridRecycleTransfer(clear = true) {
    if (!this._gridRecycleBuffer) return [];
    const transfer = [this._gridRecycleBuffer];
    if (clear) this._gridRecycleBuffer = null;
    return transfer;
  }

  _dispatchRender() {
    this._sanitisePhysicalParams();

    const { n, l, m, resolution: res, viewRadius, slicePlane, sliceOffset, viewCentre } = this.params;
    const analysisSignature = this._getAnalysisSignature();

    // Analysis data is consumed by both the statistics overlay and the node
    // overlay.  Either being active is sufficient to request a fresh analysis
    // pass from the worker.
    const includeAnalysis =
      (this.params.renderOverlay || this.params.renderNodeOverlay) &&
      analysisSignature !== this._analysisSignature;

    const analysisViewRadius = this._getCanonicalViewRadius();
    const requestId = ++this._renderRequestId;
    this._workerBusy    = true;
    this._renderPending = false;

    const reuseGridBuffer =
      this._gridRecycleBuffer instanceof ArrayBuffer
        ? this._gridRecycleBuffer
        : null;

    const msg = {
      type:           "render",
      requestId,
      n, l, m,
      nuclearCharge:  Math.max(1, Math.round(Number(this.params.nuclearCharge) || 1)),
      useReducedMass: this.params.useReducedMass !== false,
      nucleusMassKg:  Number(this.params.nucleusMassKg) || this.params.nucleusMassKg,
      res,
      viewRadius,
      slicePlane,
      sliceOffset,
      viewCentre:     { x: viewCentre.x, y: viewCentre.y, z: viewCentre.z },
      includeAnalysis,
      analysisSignature,
      analysisResolution: this._analysisConfig.resolution,
      analysisViewRadius,
      reuseGridBuffer,
    };

    const transfers = this._takeGridRecycleTransfer(false);
    const posted    = this._postWorkerMessage(msg, transfers, "render dispatch");

    if (!posted) {
      this._workerBusy    = false;
      this._renderPending = true;
      return;
    }

    if (transfers.length > 0) this._gridRecycleBuffer = null;
  }

  _applyWorkerAnalysis(data) {
    const nextPeak = Number(data.analysisPeak);
    if (Number.isFinite(nextPeak) && nextPeak > 0) {
      this._normalisationPeak           = Math.max(1e-30, nextPeak);
      this._lastStableNormalisationPeak = this._normalisationPeak;
    } else {
      this._normalisationPeak = this._lastStableNormalisationPeak;
    }

    const workerAMu = Number(data.analysisAMu);
    if (Number.isFinite(workerAMu) && workerAMu > 0) {
      this.aMuMeters = workerAMu;
    }

    if (typeof data.analysisSignature === "string" && data.analysisSignature) {
      this._analysisSignature = data.analysisSignature;
    }

    // Apply worker statistics when either overlay that consumes them is active.
    // Guard is symmetric with the includeAnalysis condition in _dispatchRender.
    if (
      (!this.params.renderOverlay && !this.params.renderNodeOverlay) ||
      !data.analysisStatistics
    ) {
      return;
    }

    this.analyser.applyWorkerStatistics(data.analysisStatistics, {
      ...this.params,
      fps:        Number(this.statistics.fps) || 0,
      resolution: Number(data.analysisResolution) || this._analysisConfig.resolution,
      viewRadius: Number(data.analysisViewRadius) || this._getCanonicalViewRadius(),
      viewCentre: { x: 0, y: 0, z: 0 },
      aMuMeters:  this.aMuMeters,
    });
  }

  _onWorkerMessage(data) {
    if (data && typeof data === "object" && data.type === "workerError") {
      const stage   = typeof data.stage   === "string" && data.stage   ? data.stage   : "unknown stage";
      const message = typeof data.message === "string" && data.message ? data.message : "unknown worker failure";
      this._handleWorkerFailure(`reported failure during ${stage}: ${message}`, data);
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

    const safeResolution = Math.max(
      64,
      Math.min(512, Math.round(Number(data.resolution) || this.params.resolution)),
    );
    const expectedBytes = safeResolution * safeResolution * Float32Array.BYTES_PER_ELEMENT;
    if (data.grid.byteLength !== expectedBytes) {
      this._workerBusy = false;
      return;
    }

    const safePeak = Number(data.peak);

    this._workerBusy = false;
    this._applyWorkerAnalysis(data);
    this.renderer.renderFromGrid(
      data.grid,
      Number.isFinite(safePeak) && safePeak > 0 ? safePeak : 1e-30,
      safeResolution,
    );
    this._gridRecycleBuffer = data.grid;

    if (this._renderPending) {
      this._renderPending = false;
      this._dispatchRender();
    }
  }

  // ---------------------------------------------------------------------------
  // GUI coordination
  // ---------------------------------------------------------------------------

  syncViewConstraints() {
    if (this.gui && typeof this.gui.updateViewConstraints === "function") {
      this.gui.updateViewConstraints();
      return;
    }
    this.requestRender();
  }

  refreshGUI() {
    if (this.gui && typeof this.gui.syncMediaControls === "function") {
      this.gui.syncMediaControls();
    }
    if (this.gui && typeof this.gui.refresh === "function") {
      this.gui.refresh();
    }
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  dispose() {
    if (this._worker) {
      this._worker.onmessage      = null;
      this._worker.onerror        = null;
      this._worker.onmessageerror = null;
      this._worker.terminate();
      this._worker = null;
    }
    this._workerBusy        = false;
    this._renderPending     = false;
    this._renderRequestId   = 0;
    this._gridRecycleBuffer = null;
    this._pendingActions    = [];

    if (this.media    && typeof this.media.dispose    === "function") this.media.dispose();
    if (this.renderer && typeof this.renderer.dispose === "function") this.renderer.dispose();
    if (this.gui      && typeof this.gui.dispose      === "function") this.gui.dispose();
  }
}
