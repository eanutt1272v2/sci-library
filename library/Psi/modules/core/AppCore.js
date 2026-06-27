class AppCore {
  static QUANTUM_LIMITS = Object.freeze({ minN: 1, maxN: 12 });
  static ALLOWED_SLICE_PLANES  = Object.freeze(['xy', 'xz', 'yz']);
  static ALLOWED_IMAGE_FORMATS = Object.freeze(['png', 'jpg', 'jpeg', 'webp']);

  constructor(assets) {
    const { metadata, colourMaps, font } = assets;
    this.metadata      = metadata;
    this.colourMaps    = colourMaps || {};
    this.colourMapKeys = Object.keys(this.colourMaps);
    if (this.colourMapKeys.length === 0) {
      this.colourMaps    = { greyscale: ColourMapLUT.GREYSCALE };
      this.colourMapKeys = ['greyscale'];
    }
    this._diagnosticsLogger =
      typeof AppDiagnostics !== 'undefined' &&
      typeof AppDiagnostics.resolveLogger === 'function'
        ? AppDiagnostics.resolveLogger('Psi')
        : { info() {}, warn() {}, error() {}, debug() {} };

    // --- ParamStore (schema-owned keys) ---
    this.store = new ParamStore(PSI_SCHEMA);
    // seed colourMap default from loaded maps
    const defaultMap = this.colourMapKeys.includes('rocket')
      ? 'rocket'
      : this.colourMapKeys[0];
    this.store.set('colourMap', defaultMap);

    // --- Legacy backing object (non-schema keys) ---
    this._legacy = {
      orbitalNotation: '',
      nuclearCharge:   1,
      useReducedMass:  true,
      nucleusMassKg:   1.67262192369e-27,
      pixelSmoothing:  true,
      renderLegend:    true,
      renderKeymapRef: false,
      viewRadius:      45,
      slicePlane:      'xz',
      sliceOffset:     0,
      viewCentre:      { x: 0, y: 0, z: 0 },
      imageFormat:     'png',
      recordingFPS:    60,
      videoBitrateMbps: 8,
    };

    // --- Proxy: schema keys hit the store, everything else hits _legacy ---
    const store  = this.store;
    const legacy = this._legacy;
    const schema = store.schema;
    this.params = new Proxy({}, {
      get(_t, key) {
        if (key in schema) return store.get(key);
        return legacy[key];
      },
      set(_t, key, value) {
        if (key in schema) { store.set(key, value); return true; }
        legacy[key] = value;
        return true;
      },
      has(_t, key) {
        return (key in schema) || (key in legacy);
      },
      ownKeys(_t) {
        return [...Object.keys(schema), ...Object.keys(legacy)];
      },
      getOwnPropertyDescriptor(_t, key) {
        if ((key in schema) || (key in legacy))
          return { configurable: true, enumerable: true, writable: true };
        return undefined;
      },
    });

    this.statistics = {
      fps: 0, peakDensity: 0, mean: 0, stdDev: 0,
      entropy: 0, concentration: 0, radialPeak: 0,
      radialSpread: 0, nodeEstimate: 0,
    };
    this.font = font;
    this._renderQueued               = false;
    this._analysisConfig             = { resolution: 384 };
    this._analysisSignature          = '';
    this._normalisationPeak          = 1e-30;
    this._lastStableNormalisationPeak = 1e-30;
    this.aMuMeters                   = 5.29177210903e-11;
    this._canonicalViewRadiusCache   = { n: -1, l: -1, Z: -1, value: 45 };

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
  // Loop hooks
  // ---------------------------------------------------------------------------

  update() {
    this.input.handleContinuousInput();
    this.statistics.fps = frameRate();
  }

  render() {
    this.renderer.render();
    if (this._renderQueued) {
      this._renderQueued = false;
      this._requestRenderNow();
    }
  }

  // ---------------------------------------------------------------------------
  // Parameter mutators (all route through store.set or _legacy directly)
  // ---------------------------------------------------------------------------

  updateQuantumNumbers(type, delta) {
    if (type === 'n') {
      this.store.set('n', Math.max(
        AppCore.QUANTUM_LIMITS.minN,
        Math.min(AppCore.QUANTUM_LIMITS.maxN, this.store.get('n') + delta),
      ));
    } else if (type === 'l') {
      this.store.set('l', Math.max(0, this.store.get('l') + delta));
    } else if (type === 'm') {
      this.store.set('m', this.store.get('m') + delta);
    }
    this.gui.enforceConstraints();
  }

  changePlane(plane) {
    if (AppCore.ALLOWED_SLICE_PLANES.includes(plane)) {
      this._legacy.slicePlane = plane;
      this.refreshGUI();
      this.requestRender();
    }
  }

  cycleColourMap() {
    const maps  = this.colourMapKeys;
    const index = maps.indexOf(this.store.get('colourMap'));
    this.store.set('colourMap', maps[(index + 1) % maps.length]);
    this.refreshGUI();
    this.requestRender();
  }

  toggleOverlay() {
    this.store.set('renderOverlay', !this.store.get('renderOverlay'));
    this.requestRender();
  }

  toggleNodeOverlay() {
    this.store.set('renderNodeOverlay', !this.store.get('renderNodeOverlay'));
    this.requestRender();
  }

  toggleLegend() {
    this._legacy.renderLegend = !this._legacy.renderLegend;
    this.requestRender();
  }

  toggleSmoothing() {
    this._legacy.pixelSmoothing = !this._legacy.pixelSmoothing;
    this.requestRender();
  }

  toggleGUI() {
    this.gui.pane.expanded = !this.gui.pane.expanded;
  }

  toggleKeymapRef() {
    this._legacy.renderKeymapRef = !this._legacy.renderKeymapRef;
    this.requestRender();
  }

  resetViewRadius() {
    this._legacy.viewRadius = 45;
    this.refreshGUI();
    this.requestRender();
  }

  resetSliceOffset() {
    this._legacy.sliceOffset = 0;
    this.refreshGUI();
    this.requestRender();
  }

  resetViewCentre() {
    const vc = this._legacy.viewCentre;
    vc.x = 0; vc.y = 0; vc.z = 0;
    this.refreshGUI();
    this.requestRender();
  }

  adjustSliceOffset(delta) {
    this._legacy.sliceOffset = constrain(
      this._legacy.sliceOffset + delta,
      -this._legacy.viewRadius,
      this._legacy.viewRadius,
    );
    this.refreshGUI();
    this.requestRender();
  }

  adjustViewRadius(delta) {
    this._legacy.viewRadius = constrain(this._legacy.viewRadius + delta, 1, 256);
    this.refreshGUI();
    this.syncViewConstraints();
  }

  adjustResolution(delta) {
    this.store.set('resolution', this.store.get('resolution') + delta);
    this.refreshGUI();
    this.requestRender();
  }

  adjustLogAlpha(delta) {
    this.store.set('logAlpha', this.store.get('logAlpha') + delta);
    this.refreshGUI();
    this.requestRender();
  }

  exportImage() {
    this.media.exportImage();
  }

  resize() {
    const canvasSize = min(windowWidth, windowHeight);
    resizeCanvas(canvasSize, canvasSize);
    this.requestRender();
  }

  // ---------------------------------------------------------------------------
  // Input delegation
  // ---------------------------------------------------------------------------

  handleWheel(event)                       { return this.input.handleWheel(event); }
  handlePointer(event)                     { return this.input.handlePointer(event); }
  handlePointerEnd(event)                  { return this.input.handlePointerEnd(event); }

  handleKeyPressed(k, kCode, event = null) {
    return KeyboardUtils.safeHandle('Psi', 'press', () =>
      this.input.handleKeyPressed(k, kCode, event));
  }

  handleKeyReleased(k, kCode, event = null) {
    return KeyboardUtils.safeHandle('Psi', 'release', () =>
      this.input.handleKeyReleased(k, kCode, event));
  }

  canvasInteraction(event) {
    if (!event || !event.target)                         return false;
    if (typeof event.target.closest !== 'function')      return false;
    if (event.target.closest('.tp-dfwv'))                return false;
    if (event.target.tagName !== 'CANVAS')               return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------

  getPlaneAxes() {
    switch (this._legacy.slicePlane) {
      case 'xy': return { axis1:'x', axis2:'y', fixedAxis:'z', axis1Label:'X', axis2Label:'Y', fixedLabel:'Z' };
      case 'yz': return { axis1:'y', axis2:'z', fixedAxis:'x', axis1Label:'Y', axis2Label:'Z', fixedLabel:'X' };
      case 'xz': default:
                 return { axis1:'x', axis2:'z', fixedAxis:'y', axis1Label:'X', axis2Label:'Z', fixedLabel:'Y' };
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
    const n = Math.max(1, Number(this.store.get('n')) || 1);
    const l = Math.max(0, Number(this.store.get('l')) || 0);
    const Z = Math.max(1, Number(this._legacy.nuclearCharge) || 1);
    const cache = this._canonicalViewRadiusCache;
    if (cache.n === n && cache.l === l && cache.Z === Z) return cache.value;
    const lHalf      = l + 0.5;
    const ratio      = lHalf / n;
    const outerRadius = (n * n / Z) * (1 + Math.sqrt(Math.max(0, 1 - ratio * ratio)));
    const value      = Math.max(8, Math.min(512, outerRadius * 1.15));
    this._canonicalViewRadiusCache = { n, l, Z, value };
    return value;
  }

  _getAnalysisSignature() {
    const n = this.store.get('n'), l = this.store.get('l'), m = this.store.get('m');
    const { slicePlane, sliceOffset, nuclearCharge, useReducedMass, nucleusMassKg } = this._legacy;
    const Z   = Math.max(1, Math.round(Number(nuclearCharge) || 1));
    const urm = useReducedMass !== false;
    return [
      n, l, m, slicePlane,
      Number(sliceOffset).toFixed(6),
      Z, urm ? 1 : 0,
      Number(nucleusMassKg || 0).toPrecision(8),
    ].join('|');
  }

  getNormalisationPeak() {
    const peak = Number(this._normalisationPeak);
    if (Number.isFinite(peak) && peak > 0) return peak;
    return Math.max(1e-30, Number(this._lastStableNormalisationPeak) || 1e-30);
  }

  // ---------------------------------------------------------------------------
  // Sanitisation (legacy keys only — store handles its own)
  // ---------------------------------------------------------------------------

  _clampNumber(value, min, max, fallback = min) {
    const v = Number(value);
    if (!Number.isFinite(v)) return fallback;
    return v < min ? min : v > max ? max : v;
  }

  _clampInteger(value, min, max, fallback = min) {
    return Math.round(this._clampNumber(value, min, max, fallback));
  }

  _sanitiseLegacyParams() {
    const p = this._legacy;
    // Quantum (legacy non-schema)
    const n = this.store.get('n');
    p.nuclearCharge = this._clampInteger(p.nuclearCharge, 1, 20, 1);
    // Mass
    const protonMass  = 1.67262192369e-27;
    p.useReducedMass  = p.useReducedMass !== false;
    const fallbackMass = p.nuclearCharge === 1
      ? protonMass
      : Math.max(protonMass, p.nuclearCharge * protonMass);
    p.nucleusMassKg = this._clampNumber(p.nucleusMassKg, 1e-33, 1e-20, fallbackMass);
    // Render flags (legacy)
    p.pixelSmoothing  = p.pixelSmoothing  !== false;
    p.renderLegend    = p.renderLegend    !== false;
    p.renderKeymapRef = Boolean(p.renderKeymapRef);
    // View / slice
    p.viewRadius = this._clampNumber(p.viewRadius, 1, 256, 45);
    if (!AppCore.ALLOWED_SLICE_PLANES.includes(p.slicePlane)) p.slicePlane = 'xz';
    p.sliceOffset = this._clampNumber(p.sliceOffset, -p.viewRadius, p.viewRadius, 0);
    if (!p.viewCentre || typeof p.viewCentre !== 'object') p.viewCentre = { x: 0, y: 0, z: 0 };
    p.viewCentre.x = this._clampNumber(p.viewCentre.x, -1024, 1024, 0);
    p.viewCentre.y = this._clampNumber(p.viewCentre.y, -1024, 1024, 0);
    p.viewCentre.z = this._clampNumber(p.viewCentre.z, -1024, 1024, 0);
    // Export
    const fmt = String(p.imageFormat || 'png').toLowerCase();
    p.imageFormat       = AppCore.ALLOWED_IMAGE_FORMATS.includes(fmt) ? fmt : 'png';
    p.recordingFPS      = this._clampInteger(p.recordingFPS, 12, 120, 60);
    p.videoBitrateMbps  = this._clampNumber(p.videoBitrateMbps, 1, 64, 8);
    // Analysis config
    this._analysisConfig.resolution = this._clampInteger(this._analysisConfig.resolution, 64, 512, 384);
  }

  // ---------------------------------------------------------------------------
  // Worker communication
  // ---------------------------------------------------------------------------

  _postWorkerMessage(msg, transfers = [], context = 'worker request') {
    if (!this._worker) return false;
    if (
      typeof AppDiagnostics !== 'undefined' &&
      typeof AppDiagnostics.safePostMessage === 'function'
    ) {
      return AppDiagnostics.safePostMessage(
        this._worker, msg, transfers, this._diagnosticsLogger, context);
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
      this._worker = new Worker('./modules/worker/PsiWorker.js');
    } catch (e) {
      throw new Error('[Psi] Worker is required but could not be created.');
    }
    this._worker.onmessage      = (e) => this._onWorkerMessage(e.data);
    this._worker.onerror        = (e) => this._handleWorkerFailure('runtime error', e);
    this._worker.onmessageerror = (e) => this._handleWorkerFailure('message deserialisation error', e);
  }

  _takeGridRecycleTransfer(clear = true) {
    if (!this._gridRecycleBuffer) return [];
    const transfer = [this._gridRecycleBuffer];
    if (clear) this._gridRecycleBuffer = null;
    return transfer;
  }

  _dispatchRender() {
    this._sanitiseLegacyParams();
    const snap = this.store.snapshot();
    const { slicePlane, sliceOffset, viewCentre, nuclearCharge,
            useReducedMass, nucleusMassKg } = this._legacy;
    const analysisSignature = this._getAnalysisSignature();
    const includeAnalysis =
      (snap.renderOverlay || snap.renderNodeOverlay) &&
      analysisSignature !== this._analysisSignature;
    const analysisViewRadius = this._getCanonicalViewRadius();
    const requestId = ++this._renderRequestId;
    this._workerBusy    = true;
    this._renderPending = false;
    const reuseGridBuffer = this._gridRecycleBuffer instanceof ArrayBuffer
      ? this._gridRecycleBuffer : null;
    const msg = {
      type: 'render', requestId,
      n: snap.n, l: snap.l, m: snap.m,
      nuclearCharge:  Math.max(1, Math.round(Number(nuclearCharge) || 1)),
      useReducedMass: useReducedMass !== false,
      nucleusMassKg:  Number(nucleusMassKg) || nucleusMassKg,
      res: snap.resolution,
      viewRadius:     this._legacy.viewRadius,
      slicePlane, sliceOffset,
      viewCentre: { x: viewCentre.x, y: viewCentre.y, z: viewCentre.z },
      includeAnalysis, analysisSignature,
      analysisResolution: this._analysisConfig.resolution,
      analysisViewRadius,
      reuseGridBuffer,
    };
    const transfers = this._takeGridRecycleTransfer(false);
    const posted    = this._postWorkerMessage(msg, transfers, 'render dispatch');
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
    if (Number.isFinite(workerAMu) && workerAMu > 0) this.aMuMeters = workerAMu;
    if (typeof data.analysisSignature === 'string' && data.analysisSignature)
      this._analysisSignature = data.analysisSignature;
    const snap = this.store.snapshot();
    if ((!snap.renderOverlay && !snap.renderNodeOverlay) || !data.analysisStatistics) return;
    this.analyser.applyWorkerStatistics(data.analysisStatistics, {
      ...snap,
      ...this._legacy,
      fps:        Number(this.statistics.fps) || 0,
      resolution: Number(data.analysisResolution) || this._analysisConfig.resolution,
      viewRadius: Number(data.analysisViewRadius) || this._getCanonicalViewRadius(),
      viewCentre: { x: 0, y: 0, z: 0 },
      aMuMeters:  this.aMuMeters,
    });
  }

  _onWorkerMessage(data) {
    if (data && typeof data === 'object' && data.type === 'workerError') {
      const stage   = typeof data.stage   === 'string' && data.stage   ? data.stage   : 'unknown stage';
      const message = typeof data.message === 'string' && data.message ? data.message : 'unknown worker failure';
      this._handleWorkerFailure(`reported failure during ${stage}: ${message}`, data);
      return;
    }
    if (!data || typeof data !== 'object' || data.type !== 'result') {
      this._workerBusy = false; return;
    }
    if (Number(data.requestId) !== this._renderRequestId) return;
    if (!(data.grid instanceof ArrayBuffer)) { this._workerBusy = false; return; }
    const res = this.store.get('resolution');
    const safeRes = Math.max(64, Math.min(512, Math.round(Number(data.resolution) || res)));
    if (data.grid.byteLength !== safeRes * safeRes * Float32Array.BYTES_PER_ELEMENT) {
      this._workerBusy = false; return;
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
    if (this.gui && typeof this.gui.updateViewConstraints === 'function') {
      this.gui.updateViewConstraints(); return;
    }
    this.requestRender();
  }

  refreshGUI() {
    if (this.gui && typeof this.gui.refresh === 'function') this.gui.refresh();
  }

  // ---------------------------------------------------------------------------
  // Cleanup
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
    this._renderQueued      = false;
    if (this.media    && typeof this.media.dispose    === 'function') this.media.dispose();
    if (this.renderer && typeof this.renderer.dispose === 'function') this.renderer.dispose();
    if (this.gui      && typeof this.gui.dispose      === 'function') this.gui.dispose();
  }
}
