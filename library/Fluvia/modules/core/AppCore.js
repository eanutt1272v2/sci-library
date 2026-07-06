import { ParamStore } from "../../../_shared/utils/ParamStore.js";
import { safePostMessage } from "../../../_shared/utils/WorkerMessaging.js";
import { ColourMapLUT } from "../../../_shared/utils/ColourMapLUT.js";
import { FLUVIA_SCHEMA } from "./ParamSchema.js";
import { Terrain } from "../model/Terrain.js";
import { Camera } from "../render/Camera.js";
import { Renderer } from "../render/Renderer.js";
import { Analyser } from "../analysis/Analyser.js";
import { Media } from "../media/Media.js";
import { GUI } from "../ui/GUI.js";
import { InputHandler } from "../input/InputHandler.js";

/**
 * AppCore owns the parameter store, the compute worker, and every module. It is
 * the single point where the schema-owned {@link ParamStore} is constructed and
 * where each module is handed a narrow, purpose-built facade — never a
 * back-reference to AppCore itself.
 */
class AppCore {
  static ALLOWED_TERRAIN_SIZES = Object.freeze([128, 256, 512]);

  /**
   * @param {Object} assets - Loaded startup assets.
   * @param {Object} p - The p5 instance (instance-mode); threaded to every
   *   module that draws or reads p5 sketch state.
   */
  constructor(assets, p) {
    const { metadata, vertShader, fragShader, colourMaps, font } = assets;

    this.p = p;
    this.metadata = metadata;
    this.shaders = { vert: vertShader, frag: fragShader };
    this.colourMaps = colourMaps || {};
    this.colourMapKeys = Object.keys(this.colourMaps);
    this.font = font;

    if (this.colourMapKeys.length === 0) {
      this.colourMaps = { greyscale: ColourMapLUT.GREYSCALE };
      this.colourMapKeys = ["greyscale"];
    }

    // --- Parameter store: the single source of truth for every param ---------
    this.store = new ParamStore(FLUVIA_SCHEMA, {
      dynamicOptions: { colourMap: this.colourMapKeys },
    });
    this.store.set(
      "colourMap",
      this.colourMapKeys.includes("viridis")
        ? "viridis"
        : this.colourMapKeys[0],
    );

    this.params = this._buildParamsView();

    this.statistics = {
      fps: 0,
      frameCounter: 0,
      simulationTime: 0,

      heightHistogram: new Int32Array(256),
      normHistogram: new Float32Array(256),

      avgElevation: 0,
      elevationStdDev: 0,
      heightBounds: { min: 0, max: 0 },

      totalWater: 0,
      totalSediment: 0,
      totalBedrock: 0,
      sedimentBounds: { min: 0, max: 0 },

      activeWaterCover: 0,
      drainageDensity: 0,
      dischargeBounds: { min: 0, max: 0 },
      hydraulicResidence: 0,

      rugosity: 0,
      slopeComplexity: 0,
      sedimentFlux: 0,
      erosionRate: 0,

      compositeWaterCoveragePct: 0,
      compositeSedimentCoveragePct: 0,
      compositeFlatCoveragePct: 0,
      compositeSteepCoveragePct: 0,
      compositeMeanSlopeWeight: 0,
      compositeMeanSedimentAlpha: 0,
      compositeMeanWaterAlpha: 0,
    };

    this.initialiseModules();
    this.terrain.generate();
  }

  /**
   * Build the live `params` view over the store. Schema keys read/write straight
   * through to the store (which coerces and clamps); the nested `lightDir` group
   * is exposed as an `{x, y, z}` object via the store's `asObject`, so existing
   * `params.lightDir.x`-style call sites keep working. Unknown keys surface the
   * store's `RangeError` rather than silently returning `undefined`.
   *
   * @returns {Object} A proxy standing in for the former plain `params` object.
   */
  _buildParamsView() {
    const store = this.store;
    const views = { lightDir: store.asObject("lightDir", ["x", "y", "z"]) };
    const ownKeys = [
      ...Object.keys(FLUVIA_SCHEMA).filter((key) => !key.includes(".")),
      ...Object.keys(views),
    ];

    return new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key !== "string") return undefined;
          if (key in views) return views[key];
          return store.get(key);
        },
        set(_target, key, value) {
          if (key in views) {
            const source = value && typeof value === "object" ? value : {};
            for (const leaf of ["x", "y", "z"]) {
              if (leaf in source) views[key][leaf] = source[leaf];
            }
            return true;
          }
          store.set(key, value);
          return true;
        },
        has(_target, key) {
          return ownKeys.includes(key);
        },
        ownKeys() {
          return [...ownKeys];
        },
        getOwnPropertyDescriptor(_target, key) {
          if (ownKeys.includes(key)) {
            return { configurable: true, enumerable: true, writable: true };
          }
          return undefined;
        },
      },
    );
  }

  initialiseModules() {
    const p = this.p;
    const self = this;

    this.terrain = new Terrain(this._terrainFacade());
    this.camera = new Camera({ params: this.params, store: this.store, p });
    this.renderer = new Renderer({
      params: this.params,
      statistics: this.statistics,
      colourMaps: this.colourMaps,
      shaders: this.shaders,
      refreshGUI: () => this.refreshGUI(),
      get terrain() {
        return self.terrain;
      },
      get camera() {
        return self.camera;
      },
      get metadata() {
        return self.metadata;
      },
      p,
    });
    this.analyser = new Analyser({
      statistics: this.statistics,
      params: this.params,
      get terrain() {
        return self.terrain;
      },
      p,
    });
    this.media = new Media(this._mediaFacade());
    this.gui = new GUI({
      params: this.params,
      store: this.store,
      statistics: this.statistics,
      colourMaps: this.colourMaps,
      metadata: this.metadata,
      media: this.media,
      generate: () => this.generate(),
      reset: () => this.reset(),
    });
    this.input = new InputHandler({
      params: this.params,
      camera: this.camera,
      media: this.media,
      gui: this.gui,
      refreshGUI: () => this.refreshGUI(),
      generate: () => this.generate(),
      reset: () => this.reset(),
      cycleColourMap: (step) => this.cycleColourMap(step),
      cycleSurfaceMap: (step) => this.cycleSurfaceMap(step),
      p,
    });

    this._worker = null;
    this._workerBusy = false;
    this._workerRequestId = 0;
    this._workerStepIntervalMs = 28;
    this._lastWorkerStepMs = 0;
    this._pendingActions = [];
    this._lastVisualSignature = this._computeVisualSignature();
    this._lastVisualSignatureCheckMs = 0;
    this._initWorker();
  }

  _terrainFacade() {
    return { params: this.params, p: this.p };
  }

  _mediaFacade() {
    const self = this;
    return {
      params: this.params,
      statistics: this.statistics,
      colourMaps: this.colourMaps,
      p: this.p,
      get terrain() {
        return self.terrain;
      },
      get metadata() {
        return self.metadata;
      },
      set metadata(value) {
        self.metadata = value;
      },
      refreshGUI: () => self.refreshGUI(),
      queueAction: (name, handler) => self.queueAction(name, handler),
      sanitiseParams: () => self.sanitiseParams(),
      normaliseTerrainSize: (value) => self.normaliseTerrainSize(value),
      reallocateTerrainBuffers: () => self.reallocateTerrainBuffers(),
      withWorkerPaused: (fn) => self.withWorkerPaused(fn),
      resizeTerrain: (size) => self.resizeTerrain(size),
      reinitialiseAnalyser: () => self.analyser.reinitialise(),
      reinitialise: () => self.reinitialise(),
    };
  }

  /**
   * Snap an arbitrary terrain dimension to the nearest allowed square size. The
   * store only clamps `terrainSize` to [128, 512]; the discrete snap that keeps
   * it at 128/256/512 lives here (imports can carry any size).
   *
   * @param {number} value
   * @returns {number}
   */
  normaliseTerrainSize(value) {
    const allowed = AppCore.ALLOWED_TERRAIN_SIZES;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return this.params.terrainSize;
    }

    let nearest = allowed[0];
    let nearestDistance = Math.abs(allowed[0] - numeric);
    for (let i = 1; i < allowed.length; i++) {
      const distance = Math.abs(allowed[i] - numeric);
      if (distance < nearestDistance) {
        nearest = allowed[i];
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  /**
   * Residual sanitisation the store cannot express: the discrete terrain-size
   * snap, and a re-coercion of the colour palette (Tweakpane can mutate a colour
   * object in place, bypassing the store's set-time coercion). Every numeric and
   * enum range is already enforced by the store on write.
   */
  sanitiseParams() {
    this.params.terrainSize = this.normaliseTerrainSize(this.params.terrainSize);

    for (const key of [
      "skyColour",
      "steepColour",
      "flatColour",
      "sedimentColour",
      "waterColour",
    ]) {
      this.store.set(key, this.store.get(key));
    }
  }

  _isValidFloatBuffer(buffer, expectedLength) {
    return (
      buffer instanceof ArrayBuffer &&
      buffer.byteLength === expectedLength * Float32Array.BYTES_PER_ELEMENT
    );
  }

  _restoreTerrainBuffers() {
    this.reallocateTerrainBuffers();
    this._workerBusy = false;
  }

  _computeWorkerStepIntervalMs() {
    const size = Number(this.params.terrainSize) || 256;
    let base = 20;
    if (size >= 512) base = 40;
    else if (size >= 384) base = 34;
    else if (size >= 256) base = 28;

    if (this.params.renderMethod === "3D") {
      base += 6;
    }

    return base;
  }

  _computeVisualSignature() {
    const p = this.params;
    return JSON.stringify({
      renderMethod: p.renderMethod,
      surfaceMap: p.surfaceMap,
      colourMap: p.colourMap,
      heightScale: p.heightScale,
      lightDir: p.lightDir,
      specularIntensity: p.specularIntensity,
      skyColour: p.skyColour,
      steepColour: p.steepColour,
      flatColour: p.flatColour,
      sedimentColour: p.sedimentColour,
      waterColour: p.waterColour,
    });
  }

  update() {
    this.sanitiseParams();

    const { camera, params } = this;

    this.input.handleContinuousInput();

    const nowMs = performance.now();
    if (nowMs - this._lastVisualSignatureCheckMs >= 120) {
      const visualSignature = this._computeVisualSignature();
      if (visualSignature !== this._lastVisualSignature) {
        this.renderer.textureDirty = true;
        this._lastVisualSignature = visualSignature;
      }
      this._lastVisualSignatureCheckMs = nowMs;
    }

    if (params.running) {
      this.analyser.update();
    }

    camera.update();
  }

  _postWorkerMessage(msg, transfers = [], context = "worker request") {
    if (!this._worker) return false;
    return safePostMessage(this._worker, msg, transfers, context);
  }

  _handleWorkerFailure(reason, detail = null) {
    console.error(`[Fluvia] Worker ${reason}`, detail);

    this._restoreTerrainBuffers();
    this._lastWorkerStepMs = 0;
  }

  _initWorker() {
    try {
      this._worker = new Worker(
        new URL("../worker/FluviaWorker.js", import.meta.url),
        { type: "module" },
      );
    } catch (e) {
      throw new Error("[Fluvia] Worker is required but could not be created.");
    }

    this._worker.onmessage = (e) => this._onWorkerMessage(e.data);
    this._worker.onerror = (e) => {
      this._handleWorkerFailure("runtime error", e);
    };
    this._worker.onmessageerror = (e) => {
      this._handleWorkerFailure("message deserialisation error", e);
    };
  }

  _dispatchWorkerStep(nowMs = performance.now()) {
    if (!this._worker || this._workerBusy) {
      return;
    }

    this.sanitiseParams();

    const { terrain, params } = this;

    if (!terrain.heightMap) return;

    const requestId = ++this._workerRequestId;

    const msg = {
      type: "step",
      requestId,
      size: terrain.size,
      randomSeed: (nowMs * 1000) | 0,
      params: {
        dropletsPerFrame: params.dropletsPerFrame,
        maxAge: params.maxAge,
        minVolume: params.minVolume,
        precipitationRate: params.precipitationRate,
        gravity: params.gravity,
        momentumTransfer: params.momentumTransfer,
        entrainment: params.entrainment,
        depositionRate: params.depositionRate,
        evaporationRate: params.evaporationRate,
        sedimentErosionRate: params.sedimentErosionRate,
        bedrockErosionRate: params.bedrockErosionRate,
        maxHeightDiff: params.maxHeightDiff,
        settlingRate: params.settlingRate,
        learningRate: params.learningRate,
        heightScale: params.heightScale,
      },

      heightMap: terrain.heightMap.buffer,
      bedrockMap: terrain.bedrockMap.buffer,
      sedimentMap: terrain.sedimentMap.buffer,
      dischargeMap: terrain.dischargeMap.buffer,
      dischargeTrack: terrain.dischargeTrack.buffer,
      momentumX: terrain.momentumX.buffer,
      momentumY: terrain.momentumY.buffer,
      momentumXTrack: terrain.momentumXTrack.buffer,
      momentumYTrack: terrain.momentumYTrack.buffer,
    };

    const transfers = [
      msg.heightMap,
      msg.bedrockMap,
      msg.sedimentMap,
      msg.dischargeMap,
      msg.dischargeTrack,
      msg.momentumX,
      msg.momentumY,
      msg.momentumXTrack,
      msg.momentumYTrack,
    ];

    const posted = this._postWorkerMessage(msg, transfers, "step dispatch");
    if (!posted) {
      this._workerBusy = false;
      this._lastWorkerStepMs = 0;
      return;
    }

    this._workerBusy = true;
    this._lastWorkerStepMs = nowMs;

    terrain.heightMap = null;
    terrain.bedrockMap = null;
    terrain.sedimentMap = null;
    terrain.dischargeMap = null;
    terrain.dischargeTrack = null;
    terrain.momentumX = null;
    terrain.momentumY = null;
    terrain.momentumXTrack = null;
    terrain.momentumYTrack = null;
  }

  _onWorkerMessage(data) {
    if (data && typeof data === "object" && data.type === "workerError") {
      const stage =
        typeof data.stage === "string" && data.stage
          ? data.stage
          : "unknown stage";
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

    if (!data || typeof data !== "object") {
      this._workerBusy = false;
      return;
    }

    if (data.type !== "result") {
      this._workerBusy = false;
      return;
    }
    if (Number(data.requestId) !== this._workerRequestId) {
      return;
    }

    const { terrain } = this;
    const expectedLength = terrain.area;
    const requiredBuffers = [
      "heightMap",
      "bedrockMap",
      "sedimentMap",
      "dischargeMap",
      "dischargeTrack",
      "momentumX",
      "momentumY",
      "momentumXTrack",
      "momentumYTrack",
    ];

    for (const key of requiredBuffers) {
      if (!this._isValidFloatBuffer(data[key], expectedLength)) {
        console.error(`[Fluvia] Invalid worker payload for ${key}`);
        this._restoreTerrainBuffers();
        return;
      }
    }

    terrain.heightMap = new Float32Array(data.heightMap);
    terrain.bedrockMap = new Float32Array(data.bedrockMap);
    terrain.sedimentMap = new Float32Array(data.sedimentMap);
    terrain.dischargeMap = new Float32Array(data.dischargeMap);
    terrain.dischargeTrack = new Float32Array(data.dischargeTrack);
    terrain.momentumX = new Float32Array(data.momentumX);
    terrain.momentumY = new Float32Array(data.momentumY);
    terrain.momentumXTrack = new Float32Array(data.momentumXTrack);
    terrain.momentumYTrack = new Float32Array(data.momentumYTrack);

    this.analyser.applyWorkerAnalysis(data.analysis || {});

    this._workerBusy = false;
  }

  render() {
    this.renderer.render();

    if (this._pendingActions.length > 0) {
      this._runNextAction();
      return;
    }

    this._workerStepIntervalMs = this._computeWorkerStepIntervalMs();
    const nowMs = performance.now();

    if (
      this.params.running &&
      this._worker &&
      this.terrain.heightMap &&
      nowMs - this._lastWorkerStepMs >= this._workerStepIntervalMs
    ) {
      this._dispatchWorkerStep(nowMs);
    }
  }

  generate() {
    this.queueAction("generate", () => this._generateNow());
  }

  _generateNow() {
    const { terrain, params } = this;

    if (terrain.size !== params.terrainSize) {
      this._reinitialiseNow();
      return;
    }
    this.withWorkerPaused(() => {
      this.reallocateTerrainBuffers();
      terrain.generate();
      this.analyser.reinitialise();
    });
  }

  reset() {
    this.queueAction("reset", () => this._resetNow());
  }

  _resetNow() {
    this.withWorkerPaused(() => {
      this.reallocateTerrainBuffers();
      this.terrain.reset();
      this.analyser.reinitialise();
    });
  }

  reinitialise() {
    this.queueAction("reinitialise", () => this._reinitialiseNow());
  }

  _reinitialiseNow() {
    this.withWorkerPaused(() => {
      this.terrain = new Terrain(this._terrainFacade());
      this.renderer.reinitialise();
      this.terrain.generate();
      this.analyser.reinitialise();
    });
  }

  /**
   * Rebuild the terrain for a new size, routing through the store so downstream
   * modules observe the size change. Used by world import when the incoming size
   * differs from the current one.
   *
   * @param {number} size
   */
  resizeTerrain(size) {
    this.params.terrainSize = size;
    this.terrain = new Terrain(this._terrainFacade());
  }

  /**
   * Run `fn` with the worker torn down and rebuilt around it. Collapses the
   * always-paired terminate/reinit sequence its callers used to write by hand.
   *
   * Deliberately does not reinitialise on failure: if `fn` throws (e.g. a
   * corrupted world-JSON import partway through copying terrain buffers into
   * freshly-resized/reallocated buffers), the worker is left terminated
   * rather than silently resumed against inconsistent state — matching the
   * pre-rearchitecture behaviour, where a mid-sequence throw left the app
   * requiring a manual Generate/Reset instead of resuming silently on
   * corrupted data. The one current caller (`Media.importWorldJSON`) already
   * runs inside a try/catch (`MediaCore._readJSONFile`) that logs a thrown
   * error, so this still fails safely, just without an unconditional reinit.
   *
   * @param {Function} fn - Work to perform while the worker is stopped.
   */
  withWorkerPaused(fn) {
    this._terminateWorker();
    if (typeof fn === "function") fn();
    this._initWorker();
  }

  _terminateWorker() {
    if (this._worker) {
      this._worker.onmessage = null;
      this._worker.onerror = null;
      this._worker.onmessageerror = null;
      this._worker.terminate();
      this._worker = null;
    }
    this._workerBusy = false;
    this._lastWorkerStepMs = 0;
  }

  queueAction(name, handler) {
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

  reallocateTerrainBuffers() {
    const { terrain } = this;
    const { area } = terrain;
    for (const key of terrain.floatMapKeys) {
      if (!terrain[key]) terrain[key] = new Float32Array(area);
    }
  }

  handleWheel(event) {
    return this.input.handleWheel(event);
  }

  handlePointer(event) {
    return this.input.handlePointer(event);
  }

  handlePointerStart(event) {
    return this.input.handlePointerStart(event);
  }

  handlePointerEnd(event) {
    return this.input.handlePointerEnd(event);
  }

  resize() {
    const p = this.p;
    const canvasSize = Math.min(p.windowWidth, p.windowHeight);
    if (p.width !== canvasSize || p.height !== canvasSize) {
      p.resizeCanvas(canvasSize, canvasSize);
    }
    this.renderer.resize();
  }

  handleKeyPressed(k, kCode, event = null) {
    return KeyboardUtils.safeHandle("Fluvia", "press", () =>
      this.input.handleKeyPressed(k, kCode, event),
    );
  }

  handleKeyReleased(k, kCode, event = null) {
    return KeyboardUtils.safeHandle("Fluvia", "release", () =>
      this.input.handleKeyReleased(k, kCode, event),
    );
  }

  cycleColourMap(step) {
    const keys = this.colourMapKeys;
    if (keys.length === 0) return;
    const current = keys.indexOf(this.params.colourMap);
    const start = current >= 0 ? current : 0;
    const next = (start + step + keys.length) % keys.length;
    this.params.colourMap = keys[next];
  }

  cycleSurfaceMap(step) {
    const maps = [
      "composite",
      "height",
      "slope",
      "discharge",
      "sediment",
      "delta",
    ];
    const current = maps.indexOf(this.params.surfaceMap);
    const start = current >= 0 ? current : 0;
    const next = (start + step + maps.length) % maps.length;
    this.params.surfaceMap = maps[next];
  }

  refreshGUI() {
    if (this.gui && typeof this.gui.syncMediaControls === "function") {
      this.gui.syncMediaControls();
    }

    if (
      this.gui &&
      this.gui.pane &&
      typeof this.gui.pane.refresh === "function"
    ) {
      this.gui.pane.refresh();
    }
  }

  dispose() {
    this._terminateWorker();
    this._pendingActions = [];

    if (this.media && typeof this.media.dispose === "function") {
      this.media.dispose();
    }

    if (this.renderer && typeof this.renderer.dispose === "function") {
      this.renderer.dispose();
    }

    if (this.gui && typeof this.gui.dispose === "function") {
      this.gui.dispose();
    }
  }
}

export { AppCore };
