class Renderer {
  // Default compression parameter for the log tone-map if params.logAlpha is
  // absent.  alpha = 200 gives a visually balanced curve: nearly linear for
  // the brightest 30 % of the range while strongly lifting the low-density
  // lobes that a power-law curve would bury in noise.
  static DEFAULT_LOG_ALPHA = 200;

  // Nodal overlay colours: matplotlib default colour-cycle entries.
  // Radial nodes  (concentric circles) — C3 red.
  // Angular nodes (cones / meridional lines) — C0 blue.
  // Both always render at full (1.0) opacity.
  static NODE_COLOUR_RADIAL  = [214,  39,  40]; // matplotlib C3 red  (RGB)
  static NODE_COLOUR_ANGULAR = [ 31, 119, 180]; // matplotlib C0 blue (RGB)

  // Bottom margin (px from canvas bottom) for the node-type key panel.
  static NODE_KEY_PANEL_BOTTOM_OFFSET = 78;

  constructor(appcore) {
    this.appcore = appcore;
    this.buffer  = null;
    this.grid    = new Float32Array(0);

    this.axisSamples     = new Float32Array(0);
    this.axisSampleCache = { resolution: 0, viewRadius: 0 };

    this.lut              = new Uint8ClampedArray(256 * 3);
    this.currentColourMap = "";

    this._lastPixelSmoothing = null;
    this.lastLegendPeak      = 1e-30;
    this.lastAMu             = 5.29177210903e-11;
  }

  // ---------------------------------------------------------------------------
  // Buffer management
  // ---------------------------------------------------------------------------

  _createReadbackBuffer(widthPx, heightPx) {
    const canvasEl = document.createElement("canvas");
    try {
      canvasEl.getContext("2d", { willReadFrequently: true });
    } catch {
      canvasEl.getContext("2d");
    }
    const buffer = createGraphics(widthPx, heightPx, canvasEl);
    if (typeof buffer.pixelDensity === "function") buffer.pixelDensity(1);
    if (typeof buffer.noSmooth     === "function") buffer.noSmooth();
    return buffer;
  }

  dispose() {
    if (this.buffer && typeof this.buffer.remove === "function") {
      this.buffer.remove();
    }
    this.buffer = null;
  }

  // ---------------------------------------------------------------------------
  // Tone-map helpers
  // ---------------------------------------------------------------------------

  // Resolve the log-alpha compression parameter.
  // Uses params.logAlpha when present and valid; falls back to DEFAULT_LOG_ALPHA.
  _getLogAlpha() {
    const a = Number(this.appcore.params.logAlpha);
    return Number.isFinite(a) && a > 0 ? a : Renderer.DEFAULT_LOG_ALPHA;
  }

  // Stable log tone-map.  Maps a linear normalised value t in [0, 1]
  // to a perceptually compressed display value in [0, 1] via
  //   u(t) = log(1 + alpha * t) / log(1 + alpha)
  _logMap(t) {
    const a = this._getLogAlpha();
    return Math.log(1 + a * t) / Math.log(1 + a);
  }

  // Inverse tone-map used for legend tick positioning:
  //   t(u) = (exp(u * log(1 + alpha)) - 1) / alpha
  _logMapInverse(u) {
    const a = this._getLogAlpha();
    return (Math.exp(u * Math.log(1 + a)) - 1) / a;
  }

  // ---------------------------------------------------------------------------
  // Axis samples (cached)
  // ---------------------------------------------------------------------------

  getAxisSamples(resolution, viewRadius) {
    const cache = this.axisSampleCache;
    if (
      cache.resolution === resolution &&
      cache.viewRadius  === viewRadius &&
      this.axisSamples.length === resolution
    ) {
      return this.axisSamples;
    }

    this.axisSamples = new Float32Array(resolution);

    if (resolution === 1) {
      this.axisSamples[0] = 0;
    } else {
      const step = (viewRadius * 2) / (resolution - 1);
      let value  = -viewRadius;
      for (let i = 0; i < resolution; i++) {
        this.axisSamples[i] = value;
        value += step;
      }
    }

    cache.resolution = resolution;
    cache.viewRadius  = viewRadius;
    return this.axisSamples;
  }

  // ---------------------------------------------------------------------------
  // LUT management
  // ---------------------------------------------------------------------------

  updateLUT(colourMap) {
    if (this.currentColourMap === colourMap) return;
    const colourData = this.appcore.colourMaps[colourMap];
    if (!colourData) return;
    this.currentColourMap = colourMap;
    ColourMapLUT.buildLUT(colourData, this.lut);
  }

  // ---------------------------------------------------------------------------
  // Slice plane utilities
  // ---------------------------------------------------------------------------

  getSliceAxes(slicePlane) {
    if (slicePlane === "xy") return { c1: 0, c2: 1, cFixed: 2 };
    if (slicePlane === "yz") return { c1: 1, c2: 2, cFixed: 0 };
    return { c1: 0, c2: 2, cFixed: 1 };
  }

  // ---------------------------------------------------------------------------
  // Grid rendering
  // ---------------------------------------------------------------------------

  renderFromGrid(gridBuffer, peak, resolutionHint) {
    const { colourMap } = this.appcore.params;
    this.grid = new Float32Array(gridBuffer);

    let res = Number(resolutionHint);
    if (!Number.isFinite(res) || res <= 0) {
      res = Math.round(Math.sqrt(this.grid.length));
    }
    res = Math.max(1, res | 0);

    if (!this.buffer || this.buffer.width !== res || this.buffer.height !== res) {
      if (this.buffer && typeof this.buffer.remove === "function") {
        this.buffer.remove();
      }
      this.buffer = this._createReadbackBuffer(res, res);
    }

    this.renderToBuffer(this.grid, peak, res, colourMap);
  }

  renderToBuffer(grid, peak, res, colourMap) {
    const { buffer } = this;
    this.updateLUT(colourMap || "rocket");

    const peakRef =
      (typeof this.appcore.getNormalisationPeak === "function" &&
        this.appcore.getNormalisationPeak()) ||
      peak ||
      1e-30;
    this.lastLegendPeak = Math.max(1e-30, Number(peakRef) || 0);

    buffer.loadPixels();
    for (let i = 0; i < res * res; i++) {
      const t        = constrain(grid[i] / peakRef, 0, 1);
      const u        = this._logMap(t);
      const lutIndex = Math.min(255, Math.max(0, Math.round(u * 255))) * 3;
      const idx      = i * 4;
      buffer.pixels[idx]     = this.lut[lutIndex];
      buffer.pixels[idx + 1] = this.lut[lutIndex + 1];
      buffer.pixels[idx + 2] = this.lut[lutIndex + 2];
      buffer.pixels[idx + 3] = 255;
    }
    buffer.updatePixels();
  }

  // ---------------------------------------------------------------------------
  // Main render call (p5 draw loop)
  // ---------------------------------------------------------------------------

  render() {
    const {
      pixelSmoothing,
      renderOverlay,
      renderNodeOverlay,
      renderLegend,
      renderKeymapRef,
    } = this.appcore.params;

    background(0);

    if (this._lastPixelSmoothing !== pixelSmoothing) {
      if (pixelSmoothing) { smooth(); } else { noSmooth(); }
      this._lastPixelSmoothing = pixelSmoothing;
    }

    if (this.buffer) image(this.buffer, 0, 0, width, height);

    if (renderNodeOverlay) this.renderNodeOverlay();
    if (renderOverlay)     this.renderOverlay();
    if (renderLegend)      this.renderLegend();
    if (renderKeymapRef)   this.renderKeymapRef();
  }

  // ---------------------------------------------------------------------------
  // Statistics overlay
  // ---------------------------------------------------------------------------

  renderOverlay() {
    const {
      n, l, m, nuclearCharge,
      viewRadius, sliceOffset, orbitalNotation, viewCentre,
      resolution, slicePlane, colourMap, pixelSmoothing,
    } = this.appcore.params;
    const statistics = this.appcore.statistics;
    const { axis1, axis2, fixedLabel, axis1Label, axis2Label } =
      this.appcore.getPlaneAxes();

    // Route through _getLogAlpha() so this readout is always consistent with
    // the value actually used by the tone-map pipeline.
    const logAlpha = this._getLogAlpha();

    const lines = [
      `Orbital: ${orbitalNotation}`,
      `Quantum: n=${n}, l=${l}, m=${m}`,
      `Nuclear Charge: Z=${nuclearCharge}`,
      `FPS=${statistics.fps.toFixed(1)} [Hz]`,
      `Resolution=${resolution} [px]`,
      `Plane: ${slicePlane.toUpperCase()}`,
      `Slice ${fixedLabel}=${sliceOffset.toFixed(2)} [a\u2080]`,
      `View Radius=${viewRadius.toFixed(2)} [a\u2080]`,
      `Pan ${axis1Label}=${viewCentre[axis1].toFixed(2)} [a\u2080]`,
      `Pan ${axis2Label}=${viewCentre[axis2].toFixed(2)} [a\u2080]`,
      `Mean Density=${this._fmtSci(statistics.mean, 3)} [m\u207b\u00b3]`,
      `Density Std Dev=${this._fmtSci(statistics.stdDev, 3)} [m\u207b\u00b3]`,
      `Density Peak=${this._fmtSci(statistics.peakDensity, 3)} [m\u207b\u00b3]`,
      `Entropy=${this._fmtSci(statistics.entropy, 3)}`,
      `Concentration=${this._fmtSci(statistics.concentration, 3)}`,
      `Radial Peak=${statistics.radialPeak.toFixed(3)} [a\u2080]`,
      `Radial Spread=${statistics.radialSpread.toFixed(3)} [a\u2080]`,
      `Node Estimate=${statistics.nodeEstimate.toFixed(0)}`,
      `Colour Map: ${colourMap} (palette id)`,
      `Pixel Smoothing: ${pixelSmoothing ? "true" : "false"}`,
      `Log Alpha: ${logAlpha.toFixed(1)}`,
    ];

    push();
    textAlign(LEFT, TOP);
    textSize(12);
    noStroke();
    fill(255);
    text(lines.join("\n"), 20, 20);
    pop();
  }

  // ---------------------------------------------------------------------------
  // Node overlay
  // ---------------------------------------------------------------------------

  _worldToScreen(axis1Value, axis2Value, params, axis1, axis2) {
    const viewRadius = Math.max(1e-6, Number(params.viewRadius) || 1);
    const centre1    = Number(params.viewCentre?.[axis1]) || 0;
    const centre2    = Number(params.viewCentre?.[axis2]) || 0;
    return {
      x: ((axis1Value - centre1 + viewRadius) / (2 * viewRadius)) * width,
      y: ((axis2Value - centre2 + viewRadius) / (2 * viewRadius)) * height,
    };
  }

  _renderNodeTypeKey(radialCount, angularCount) {
    const panelX = 20;
    const panelY = height - Renderer.NODE_KEY_PANEL_BOTTOM_OFFSET;
    const [rR, rG, rB] = Renderer.NODE_COLOUR_RADIAL;
    const [aR, aG, aB] = Renderer.NODE_COLOUR_ANGULAR;

    push();
    fill(255);
    textAlign(LEFT, TOP);
    textSize(12);
    text("Detected Nodes", panelX + 10, panelY + 1);

    strokeWeight(2);

    stroke(rR, rG, rB, 255);
    line(panelX + 12, panelY + 30, panelX + 32, panelY + 30);
    noStroke();
    fill(255);
    text(`Radial: ${radialCount}`, panelX + 40, panelY + 23);

    stroke(aR, aG, aB, 255);
    line(panelX + 12, panelY + 52, panelX + 32, panelY + 52);
    noStroke();
    fill(255);
    text(`Angular: ${angularCount}`, panelX + 40, panelY + 45);

    pop();
  }

  renderNodeOverlay() {
    const { params } = this.appcore;
    const { analyser } = this.appcore;
    if (!analyser || typeof analyser.computeNodeOverlayData !== "function") return;

    const { axis1, axis2, fixedAxis } = this.appcore.getPlaneAxes();
    const viewRadius = Math.max(1e-6, Number(params.viewRadius) || 1);
    const centre1    = Number(params.viewCentre?.[axis1])   || 0;
    const centre2    = Number(params.viewCentre?.[axis2])   || 0;
    const fixedCoord =
      (Number(params.viewCentre?.[fixedAxis]) || 0) +
      (Number(params.sliceOffset) || 0);

    const overlayData       = analyser.computeNodeOverlayData({ ...params, aMuMeters: this.appcore.aMuMeters });
    const radialNodeRadii   = overlayData.radialNodeRadii   || [];
    const angularNodeThetas = overlayData.angularNodeThetas || [];
    const angularNodePhis   = overlayData.angularNodePhis   || [];

    const pixelScale = Math.min(width, height) / (2 * viewRadius);
    const origin     = this._worldToScreen(0, 0, params, axis1, axis2);

    // Destructure colour statics once; all strokes use full alpha (255).
    const [rR, rG, rB] = Renderer.NODE_COLOUR_RADIAL;
    const [aR, aG, aB] = Renderer.NODE_COLOUR_ANGULAR;

    push();
    noFill();
    strokeWeight(1.6);

    // --- Radial nodes (concentric circles) ---
    stroke(rR, rG, rB, 255);
    for (const radius of radialNodeRadii) {
      if (!Number.isFinite(radius) || radius <= 0) continue;
      if (Math.abs(fixedCoord) > radius) continue;
      const inPlaneRadius = Math.sqrt(Math.max(0, radius * radius - fixedCoord * fixedCoord));
      const pxRadius      = inPlaneRadius * pixelScale;
      if (!Number.isFinite(pxRadius) || pxRadius <= 0.6) continue;
      ellipse(origin.x, origin.y, 2 * pxRadius, 2 * pxRadius);
    }

    // --- Angular nodes ---
    stroke(aR, aG, aB, 255);
    if (params.slicePlane === "xy") {
      for (const theta of angularNodeThetas) {
        if (!Number.isFinite(theta)) continue;
        const tanTheta = Math.tan(theta);
        if (!Number.isFinite(tanTheta)) continue;
        const pxRadius = Math.abs(fixedCoord) * Math.abs(tanTheta) * pixelScale;
        if (!Number.isFinite(pxRadius) || pxRadius <= 0.6) continue;
        ellipse(origin.x, origin.y, 2 * pxRadius, 2 * pxRadius);
      }

      for (const phi of angularNodePhis) {
        if (!Number.isFinite(phi)) continue;
        const extent = viewRadius * 1.5;
        const p1 = this._worldToScreen(-extent * Math.cos(phi), -extent * Math.sin(phi), params, axis1, axis2);
        const p2 = this._worldToScreen( extent * Math.cos(phi),  extent * Math.sin(phi), params, axis1, axis2);
        line(p1.x, p1.y, p2.x, p2.y);
      }
    } else {
      const SAMPLES = 160;
      for (const theta of angularNodeThetas) {
        if (!Number.isFinite(theta)) continue;
        const tanTheta = Math.tan(theta);
        if (!Number.isFinite(tanTheta) || Math.abs(tanTheta) < 1e-6) continue;

        for (const sign of [-1, 1]) {
          let prevPoint = null;
          for (let i = 0; i <= SAMPLES; i++) {
            const axis1Value = centre1 - viewRadius + (i / SAMPLES) * 2 * viewRadius;
            const axis2Value = (sign * Math.sqrt(axis1Value * axis1Value + fixedCoord * fixedCoord)) / tanTheta;
            const visible =
              Number.isFinite(axis2Value) &&
              axis2Value >= centre2 - viewRadius &&
              axis2Value <= centre2 + viewRadius;

            if (!visible) { prevPoint = null; continue; }

            const current = this._worldToScreen(axis1Value, axis2Value, params, axis1, axis2);
            if (prevPoint) line(prevPoint.x, prevPoint.y, current.x, current.y);
            prevPoint = current;
          }
        }
      }

      for (const phi of angularNodePhis) {
        if (!Number.isFinite(phi)) continue;

        if (params.slicePlane === "xz") {
          const sinPhi = Math.sin(phi);
          if (Math.abs(sinPhi) < 1e-6) continue;
          const xConst = (fixedCoord * Math.cos(phi)) / sinPhi;
          if (xConst < centre1 - viewRadius || xConst > centre1 + viewRadius) continue;
          const p1 = this._worldToScreen(xConst, centre2 - viewRadius, params, axis1, axis2);
          const p2 = this._worldToScreen(xConst, centre2 + viewRadius, params, axis1, axis2);
          line(p1.x, p1.y, p2.x, p2.y);
        } else if (params.slicePlane === "yz") {
          const cosPhi = Math.cos(phi);
          if (Math.abs(cosPhi) < 1e-6) continue;
          const yConst = (fixedCoord * Math.sin(phi)) / cosPhi;
          if (yConst < centre1 - viewRadius || yConst > centre1 + viewRadius) continue;
          const p1 = this._worldToScreen(yConst, centre2 - viewRadius, params, axis1, axis2);
          const p2 = this._worldToScreen(yConst, centre2 + viewRadius, params, axis1, axis2);
          line(p1.x, p1.y, p2.x, p2.y);
        }
      }
    }

    pop();

    this._renderNodeTypeKey(
      radialNodeRadii.length,
      angularNodeThetas.length + angularNodePhis.length,
    );
  }

  // ---------------------------------------------------------------------------
  // Legend
  // ---------------------------------------------------------------------------

  getSuperscript(num) {
    const map = {
      0: "\u2070", 1: "\u00b9", 2: "\u00b2", 3: "\u00b3",
      4: "\u2074", 5: "\u2075", 6: "\u2076", 7: "\u2077",
      8: "\u2078", 9: "\u2079", "-": "\u207b",
    };
    return String(num).split("").map((c) => map[c] || c).join("");
  }

  renderLegend() {
    push();
    const { colourMap } = this.appcore.params;
    this.updateLUT(colourMap || "rocket");

    const x  = width - 20;
    const y1 = 34;
    const y2 = height - 20;
    const w  = 15;
    const h  = y2 - y1;

    // Gradient: top = peak (u = 1), bottom = zero (u = 0).
    const grad  = drawingContext.createLinearGradient(0, y1, 0, y2);
    const stops = 32;
    for (let i = 0; i <= stops; i++) {
      const s      = i / stops;
      const idx    = Math.round((1 - s) * 255) * 3;
      const safeIdx = Math.min(255 * 3, Math.max(0, idx));
      grad.addColorStop(
        s,
        `rgb(${this.lut[safeIdx]}, ${this.lut[safeIdx + 1]}, ${this.lut[safeIdx + 2]})`,
      );
    }

    noStroke();
    drawingContext.fillStyle = grad;
    drawingContext.fillRect(x - w, y1, w, h);

    noFill();
    stroke(255, 255, 255, 200);
    strokeWeight(1.5);
    rect(x - w, y1, w, h);

    const maxV      = Math.max(1e-30, Number(this.lastLegendPeak) || 0);
    const k         = Math.floor(Math.log10(maxV));
    const scale     = Math.pow(10, k);
    const scaledMax = maxV / scale;

    const rawStep  = scaledMax / 7;
    const stepMag  = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1e-9))));
    const stepNorm = rawStep / stepMag;
    let niceNorm   = 1;
    if      (stepNorm > 5)   niceNorm = 10;
    else if (stepNorm > 2.5) niceNorm = 5;
    else if (stepNorm > 2)   niceNorm = 2.5;
    else if (stepNorm > 1)   niceNorm = 2;
    const step = niceNorm * stepMag;

    const labels = [{ val: scaledMax, y: y1 }];
    const start  = Math.floor(scaledMax / step) * step;
    for (let v = start; v >= -1e-12; v -= step) {
      if (scaledMax - v < 1e-9) continue;
      const tv      = Math.max(0, v);
      const tLinear = tv / scaledMax;
      const tMapped = this._logMap(constrain(tLinear, 0, 1));
      labels.push({ val: tv, y: y1 + (1 - tMapped) * h });
    }

    const decimals = step >= 1 ? 1 : step >= 0.1 ? 2 : 3;

    fill(255);
    noStroke();
    textSize(11);
    textAlign(RIGHT, CENTER);
    labels.forEach((label) => {
      noStroke();
      text(label.val.toFixed(decimals), x - w - 6, label.y);
      stroke(255, 255, 255, 150);
      strokeWeight(1);
      line(x - w - 3, label.y, x - w, label.y);
    });

    noStroke();
    fill(255);
    textAlign(CENTER, BOTTOM);
    textSize(14);
    text(`\u00d710${this.getSuperscript(k)}`, x - w * 0.6, y1 - 6);

    push();
    translate(x + w * 0.5, y1 + h * 0.5);
    rotate(-HALF_PI);
    textAlign(CENTER, CENTER);
    textSize(12);
    text("Probability density |\u03c8|\u00b2 [m\u207b\u00b3]", 0, 0);
    pop();
    pop();
  }

  // ---------------------------------------------------------------------------
  // Keymap reference
  // ---------------------------------------------------------------------------

  renderKeymapRef() {
    const { name, version } = this.appcore.metadata;
    const sections = KeybindCatalogue.getSections("psi");
    KeymapRenderer.render(name, version, sections);
  }

  // ---------------------------------------------------------------------------
  // Formatting utilities
  // ---------------------------------------------------------------------------

  _fmtSci(v, digits = 3) {
    if (!Number.isFinite(v)) return "0";
    if (v === 0)              return "0";
    const [mantissa, exponent] = Number(v).toExponential(digits).split("e");
    return `${mantissa}e^${Number(exponent)}`;
  }
}
