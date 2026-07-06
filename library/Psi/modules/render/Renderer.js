import { ColourMapLUT } from "../../../_shared/utils/ColourMapLUT.js";

class Renderer {
  static DEFAULT_LOG_ALPHA = 200;
  static DENSITY_FLOOR = 1e-30;
  static NODE_COLOUR_RADIAL = [214, 39, 40];
  static NODE_COLOUR_ANGULAR = [31, 119, 180];
  static NODE_KEY_PANEL_BOTTOM_OFFSET = 78;

  static SUPERSCRIPT_MAP = Object.freeze({
    0: "⁰", 1: "¹", 2: "²", 3: "³",
    4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷",
    8: "⁸", 9: "⁹", "-": "⁻",
  });

  /**
   * @param {Object} facade - Renderer's narrow view of AppCore:
   *   `{store, statistics, analyser, colourMaps, metadata, getPlaneAxes,
   *   getNormalisationPeak, p}`. No back-reference to AppCore itself.
   */
  constructor(facade) {
    this.store = facade.store;
    this.statistics = facade.statistics;
    this.analyser = facade.analyser;
    this.colourMaps = facade.colourMaps;
    this.getPlaneAxes = facade.getPlaneAxes;
    this.getNormalisationPeak = facade.getNormalisationPeak;
    this.p = facade.p;
    this._facade = facade; // metadata is a live getter on the facade

    this.buffer = null;
    this.grid = new Float32Array(0);
    this.lut = new Uint8ClampedArray(256 * 3);
    this.currentColourMap = "";
    this._lastPixelSmoothing = null;
    this.lastLegendPeak = Renderer.DENSITY_FLOOR;
    this.lastAMu = 5.29177210903e-11;
    this._cachedLogAlpha = -1;
    this._cachedLogDenom = Math.log(1 + Renderer.DEFAULT_LOG_ALPHA);
    this._screenPoint = { x: 0, y: 0 };
    // Legend gradient cache — invalidated when colourMap or logAlpha changes
    this._legendGradientCanvas = null;
    this._legendGradientCmKey = "";
    this._legendGradientAlpha = -1;
    this._legendGradientH = 0;
  }

  /**
   * Read a plain, mutable params object from the store, with `viewCentre`
   * re-nested to `{x, y, z}` for the overlay/geometry helpers.
   *
   * @returns {Object}
   */
  _params() {
    const s = this.store.snapshot();
    return {
      ...s,
      viewCentre: {
        x: s["viewCentre.x"],
        y: s["viewCentre.y"],
        z: s["viewCentre.z"],
      },
    };
  }

  _createReadbackBuffer(widthPx, heightPx) {
    const buffer = this.p.createGraphics(widthPx, heightPx);
    if (typeof buffer.pixelDensity === "function") buffer.pixelDensity(1);
    if (typeof buffer.noSmooth === "function") buffer.noSmooth();
    try {
      buffer.elt.getContext("2d", { willReadFrequently: true });
    } catch (_) {
      // willReadFrequently hint is advisory; safe to proceed without it
    }
    return buffer;
  }

  dispose() {
    if (this.buffer && typeof this.buffer.remove === "function") {
      this.buffer.remove();
    }
    this.buffer = null;
    this._legendGradientCanvas = null;
  }

  _getLogAlpha() {
    const a = Number(this.store.get("logAlpha"));
    return Number.isFinite(a) && a > 0 ? a : Renderer.DEFAULT_LOG_ALPHA;
  }

  _prepareLogCache() {
    const a = this._getLogAlpha();
    if (a !== this._cachedLogAlpha) {
      this._cachedLogAlpha = a;
      this._cachedLogDenom = Math.log(1 + a);
    }
  }

  _logMap(t) {
    return Math.log(1 + this._cachedLogAlpha * t) / this._cachedLogDenom;
  }

  _logMapInverse(u) {
    return (Math.exp(u * this._cachedLogDenom) - 1) / this._cachedLogAlpha;
  }

  updateLUT(colourMap) {
    if (this.currentColourMap === colourMap) return;
    const colourData = this.colourMaps[colourMap];
    if (!colourData) return;
    this.currentColourMap = colourMap;
    ColourMapLUT.buildLUT(this.p, colourData, this.lut);
    // Colour map changed — invalidate the legend gradient cache
    this._legendGradientCmKey = "";
  }

  renderFromGrid(gridBuffer, peak, resolutionHint) {
    const colourMap = this.store.get("colourMap");
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
    this._prepareLogCache();
    const a = this._cachedLogAlpha;
    const denom = this._cachedLogDenom;
    const peakRef = Math.max(
      Renderer.DENSITY_FLOOR,
      (typeof this.getNormalisationPeak === "function" &&
        this.getNormalisationPeak()) ||
        peak ||
        Renderer.DENSITY_FLOOR,
    );
    this.lastLegendPeak = peakRef;
    buffer.loadPixels();
    for (let i = 0; i < res * res; i++) {
      const t = Math.min(grid[i] / peakRef, 1);
      const u = Math.log(1 + a * t) / denom;
      const lutIndex = Math.min(255, Math.max(0, Math.round(u * 255))) * 3;
      const idx = i * 4;
      buffer.pixels[idx] = this.lut[lutIndex];
      buffer.pixels[idx + 1] = this.lut[lutIndex + 1];
      buffer.pixels[idx + 2] = this.lut[lutIndex + 2];
      buffer.pixels[idx + 3] = 255;
    }
    buffer.updatePixels();
  }

  render() {
    const p = this.p;
    const params = this._params();
    const {
      pixelSmoothing,
      renderOverlay,
      renderNodeOverlay,
      renderLegend,
      renderKeymapRef,
    } = params;
    p.background(0);
    if (this._lastPixelSmoothing !== pixelSmoothing) {
      if (pixelSmoothing) {
        p.smooth();
      } else {
        p.noSmooth();
      }
      this._lastPixelSmoothing = pixelSmoothing;
    }
    if (this.buffer) p.image(this.buffer, 0, 0, p.width, p.height);
    if (renderNodeOverlay) this.renderNodeOverlay(params);
    if (renderOverlay) this.renderOverlay(params);
    if (renderLegend) this.renderLegend();
    if (renderKeymapRef) this.renderKeymapRef();
  }

  /**
   * @param {Object} params - A single frame's params, computed once in
   *   `render()` and threaded through here (and to `renderNodeOverlay`)
   *   rather than each overlay re-snapshotting the store independently.
   */
  renderOverlay(params) {
    const p = this.p;
    const {
      n, l, m, nuclearCharge,
      viewRadius, sliceOffset, viewCentre,
      resolution, slicePlane, colourMap, pixelSmoothing,
    } = params;
    const orbitalNotation = this.statistics.orbitalNotation;
    const statistics = this.statistics;
    const { axis1, axis2, fixedLabel, axis1Label, axis2Label } =
      this.getPlaneAxes();
    const logAlpha = this._getLogAlpha();
    const lines = [
      `Orbital: ${orbitalNotation}`,
      `Quantum: n=${n}, l=${l}, m=${m}`,
      `Nuclear Charge: Z=${nuclearCharge}`,
      `FPS=${statistics.fps.toFixed(1)} [Hz]`,
      `Resolution=${resolution} [px]`,
      `Plane: ${slicePlane.toUpperCase()}`,
      `Slice ${fixedLabel}=${sliceOffset.toFixed(2)} [a₀]`,
      `View Radius=${viewRadius.toFixed(2)} [a₀]`,
      `Pan ${axis1Label}=${viewCentre[axis1].toFixed(2)} [a₀]`,
      `Pan ${axis2Label}=${viewCentre[axis2].toFixed(2)} [a₀]`,
      `Mean Density=${this._fmtSci(statistics.mean, 3)} [m⁻³]`,
      `Density Std Dev=${this._fmtSci(statistics.stdDev, 3)} [m⁻³]`,
      `Density Peak=${this._fmtSci(statistics.peakDensity, 3)} [m⁻³]`,
      `Entropy=${this._fmtSci(statistics.entropy, 3)}`,
      `Concentration=${this._fmtSci(statistics.concentration, 3)}`,
      `Radial Peak=${statistics.radialPeak.toFixed(3)} [a₀]`,
      `Radial Spread=${statistics.radialSpread.toFixed(3)} [a₀]`,
      `Node Estimate=${statistics.nodeEstimate.toFixed(0)}`,
      `Colour Map: ${colourMap} (palette id)`,
      `Pixel Smoothing: ${pixelSmoothing ? "true" : "false"}`,
      `Log Alpha: ${logAlpha.toFixed(1)}`,
    ];
    p.push();
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(12);
    p.noStroke();
    p.fill(255);
    p.text(lines.join("\n"), 20, 20);
    p.pop();
  }

  _worldToScreen(axis1Value, axis2Value, params, axis1, axis2) {
    const p = this.p;
    const viewRadius = Math.max(1e-6, Number(params.viewRadius) || 1);
    const centre1 = Number(params.viewCentre?.[axis1]) || 0;
    const centre2 = Number(params.viewCentre?.[axis2]) || 0;
    this._screenPoint.x =
      ((axis1Value - centre1 + viewRadius) / (2 * viewRadius)) * p.width;
    this._screenPoint.y =
      ((axis2Value - centre2 + viewRadius) / (2 * viewRadius)) * p.height;
    return this._screenPoint;
  }

  _renderNodeTypeKey(radialCount, angularCount) {
    const p = this.p;
    const panelX = 20;
    const panelY = p.height - Renderer.NODE_KEY_PANEL_BOTTOM_OFFSET;
    const [rR, rG, rB] = Renderer.NODE_COLOUR_RADIAL;
    const [aR, aG, aB] = Renderer.NODE_COLOUR_ANGULAR;
    p.push();
    p.fill(255);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(12);
    p.text("Detected Nodes", panelX + 10, panelY + 1);
    p.strokeWeight(2);
    p.stroke(rR, rG, rB, 255);
    p.line(panelX + 12, panelY + 30, panelX + 32, panelY + 30);
    p.noStroke();
    p.fill(255);
    p.text(`Radial: ${radialCount}`, panelX + 40, panelY + 23);
    p.stroke(aR, aG, aB, 255);
    p.line(panelX + 12, panelY + 52, panelX + 32, panelY + 52);
    p.noStroke();
    p.fill(255);
    p.text(`Angular: ${angularCount}`, panelX + 40, panelY + 45);
    p.pop();
  }

  /**
   * @param {Object} params - See {@link Renderer#renderOverlay}.
   */
  renderNodeOverlay(params) {
    const p = this.p;
    const analyser = this.analyser;
    if (!analyser || typeof analyser.computeNodeOverlayData !== "function") return;
    const { axis1, axis2, fixedAxis } = this.getPlaneAxes();
    const viewRadius = Math.max(1e-6, Number(params.viewRadius) || 1);
    const centre1 = Number(params.viewCentre?.[axis1]) || 0;
    const centre2 = Number(params.viewCentre?.[axis2]) || 0;
    const fixedCoord =
      (Number(params.viewCentre?.[fixedAxis]) || 0) +
      (Number(params.sliceOffset) || 0);
    const overlayData = analyser.computeNodeOverlayData({
      ...params,
      aMuMeters: this.statistics.aMuMeters,
    });
    const radialNodeRadii = overlayData.radialNodeRadii || [];
    const angularNodeThetas = overlayData.angularNodeThetas || [];
    const angularNodePhis = overlayData.angularNodePhis || [];
    const pixelScale = Math.min(p.width, p.height) / (2 * viewRadius);
    const originPt = this._worldToScreen(0, 0, params, axis1, axis2);
    const originX = originPt.x;
    const originY = originPt.y;
    const [rR, rG, rB] = Renderer.NODE_COLOUR_RADIAL;
    const [aR, aG, aB] = Renderer.NODE_COLOUR_ANGULAR;
    p.push();
    p.noFill();
    p.strokeWeight(1.6);
    p.stroke(rR, rG, rB, 255);
    for (const radius of radialNodeRadii) {
      if (!Number.isFinite(radius) || radius <= 0) continue;
      if (Math.abs(fixedCoord) > radius) continue;
      const inPlaneRadius = Math.sqrt(Math.max(0, radius * radius - fixedCoord * fixedCoord));
      const pxRadius = inPlaneRadius * pixelScale;
      if (!Number.isFinite(pxRadius) || pxRadius <= 0.6) continue;
      p.ellipse(originX, originY, 2 * pxRadius, 2 * pxRadius);
    }
    p.stroke(aR, aG, aB, 255);
    if (params.slicePlane === "xy") {
      for (const theta of angularNodeThetas) {
        if (!Number.isFinite(theta)) continue;
        const tanTheta = Math.tan(theta);
        if (!Number.isFinite(tanTheta)) continue;
        const pxRadius = Math.abs(fixedCoord) * Math.abs(tanTheta) * pixelScale;
        if (!Number.isFinite(pxRadius) || pxRadius <= 0.6) continue;
        p.ellipse(originX, originY, 2 * pxRadius, 2 * pxRadius);
      }
      for (const phi of angularNodePhis) {
        if (!Number.isFinite(phi)) continue;
        const extent = viewRadius * 1.5;
        const p1 = this._worldToScreen(-extent * Math.cos(phi), -extent * Math.sin(phi), params, axis1, axis2);
        const x1 = p1.x;
        const y1 = p1.y;
        const p2 = this._worldToScreen(extent * Math.cos(phi), extent * Math.sin(phi), params, axis1, axis2);
        p.line(x1, y1, p2.x, p2.y);
      }
    } else {
      const SAMPLES = 160;
      for (const theta of angularNodeThetas) {
        if (!Number.isFinite(theta)) continue;
        const tanTheta = Math.tan(theta);
        if (!Number.isFinite(tanTheta) || Math.abs(tanTheta) < 1e-6) continue;
        for (const sign of [-1, 1]) {
          p.beginShape();
          let inShape = false;
          for (let i = 0; i <= SAMPLES; i++) {
            const axis1Value = centre1 - viewRadius + (i / SAMPLES) * 2 * viewRadius;
            const axis2Value = (sign * Math.sqrt(axis1Value * axis1Value + fixedCoord * fixedCoord)) / tanTheta;
            const visible =
              Number.isFinite(axis2Value) &&
              axis2Value >= centre2 - viewRadius &&
              axis2Value <= centre2 + viewRadius;
            if (!visible) {
              if (inShape) {
                p.endShape();
                p.beginShape();
                inShape = false;
              }
              continue;
            }
            const pt = this._worldToScreen(axis1Value, axis2Value, params, axis1, axis2);
            p.vertex(pt.x, pt.y);
            inShape = true;
          }
          p.endShape();
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
          const x1 = p1.x;
          const y1 = p1.y;
          const p2 = this._worldToScreen(xConst, centre2 + viewRadius, params, axis1, axis2);
          p.line(x1, y1, p2.x, p2.y);
        } else if (params.slicePlane === "yz") {
          const cosPhi = Math.cos(phi);
          if (Math.abs(cosPhi) < 1e-6) continue;
          const yConst = (fixedCoord * Math.sin(phi)) / cosPhi;
          if (yConst < centre1 - viewRadius || yConst > centre1 + viewRadius) continue;
          const p1 = this._worldToScreen(yConst, centre2 - viewRadius, params, axis1, axis2);
          const x1 = p1.x;
          const y1 = p1.y;
          const p2 = this._worldToScreen(yConst, centre2 + viewRadius, params, axis1, axis2);
          p.line(x1, y1, p2.x, p2.y);
        }
      }
    }
    p.pop();
    this._renderNodeTypeKey(
      radialNodeRadii.length,
      angularNodeThetas.length + angularNodePhis.length,
    );
  }

  getSuperscript(num) {
    const map = Renderer.SUPERSCRIPT_MAP;
    return String(num).split("").map((c) => map[c] || c).join("");
  }

  _buildLegendGradient(x, y1, y2, w, h) {
    const cmKey = this.currentColourMap;
    const alpha = this._cachedLogAlpha;
    const needsRebuild =
      this._legendGradientCmKey !== cmKey ||
      this._legendGradientAlpha !== alpha ||
      this._legendGradientH !== h ||
      !this._legendGradientCanvas;
    if (needsRebuild) {
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      const stops = 32;
      for (let i = 0; i <= stops; i++) {
        const s = i / stops;
        const idx = Math.round((1 - s) * 255) * 3;
        const safeIdx = Math.min(255 * 3, Math.max(0, idx));
        grad.addColorStop(
          s,
          `rgb(${this.lut[safeIdx]}, ${this.lut[safeIdx + 1]}, ${this.lut[safeIdx + 2]})`,
        );
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      this._legendGradientCanvas = offscreen;
      this._legendGradientCmKey = cmKey;
      this._legendGradientAlpha = alpha;
      this._legendGradientH = h;
    }
    this.p.drawingContext.drawImage(this._legendGradientCanvas, x - w, y1, w, h);
  }

  renderLegend() {
    const p = this.p;
    p.push();
    const colourMap = this.store.get("colourMap");
    this.updateLUT(colourMap || "rocket");
    this._prepareLogCache();
    const x = p.width - 20;
    const y1 = 34;
    const y2 = p.height - 20;
    const w = 15;
    const h = y2 - y1;
    this._buildLegendGradient(x, y1, y2, w, h);
    p.noStroke();
    p.stroke(255, 255, 255, 200);
    p.strokeWeight(1.5);
    p.noFill();
    p.rect(x - w, y1, w, h);
    const maxV = Math.max(Renderer.DENSITY_FLOOR, Number(this.lastLegendPeak) || 0);
    const k = Math.floor(Math.log10(maxV));
    const scale = Math.pow(10, k);
    const scaledMax = maxV / scale;
    const rawStep = scaledMax / 7;
    const stepMag = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1e-9))));
    const stepNorm = rawStep / stepMag;
    let niceNorm = 1;
    if (stepNorm > 5) niceNorm = 10;
    else if (stepNorm > 2.5) niceNorm = 5;
    else if (stepNorm > 2) niceNorm = 2.5;
    else if (stepNorm > 1) niceNorm = 2;
    const step = niceNorm * stepMag;
    const labels = [{ val: scaledMax, y: y1 }];
    const start = Math.floor(scaledMax / step) * step;
    for (let v = start; v >= -1e-12; v -= step) {
      if (scaledMax - v < 1e-9) continue;
      const tv = Math.max(0, v);
      const tLinear = tv / scaledMax;
      const tMapped = this._logMap(Math.min(tLinear, 1));
      labels.push({ val: tv, y: y1 + (1 - tMapped) * h });
    }
    const decimals = step >= 1 ? 1 : step >= 0.1 ? 2 : 3;
    p.fill(255);
    p.noStroke();
    p.textSize(11);
    p.textAlign(p.RIGHT, p.CENTER);
    labels.forEach((label) => {
      p.noStroke();
      p.text(label.val.toFixed(decimals), x - w - 6, label.y);
      p.stroke(255, 255, 255, 150);
      p.strokeWeight(1);
      p.line(x - w - 3, label.y, x - w, label.y);
    });
    p.noStroke();
    p.fill(255);
    p.textAlign(p.CENTER, p.BOTTOM);
    p.textSize(14);
    p.text(`×10${this.getSuperscript(k)}`, x - w * 0.6, y1 - 6);
    p.push();
    p.translate(x + w * 0.5, y1 + h * 0.5);
    p.rotate(-p.HALF_PI);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(12);
    p.text("Probability density |ψ|² [m⁻³]", 0, 0);
    p.pop();
    p.pop();
  }

  renderKeymapRef() {
    const { name, version } = this._facade.metadata;
    const sections = KeybindCatalogue.getSections("psi");
    KeymapRenderer.render(name, version, sections);
  }

  _fmtSci(v, digits = 3) {
    if (!Number.isFinite(v)) return "0";
    if (v === 0) return "0";
    const parts = Number(v).toExponential(digits).split("e");
    const mantissa = parts[0];
    const expStr = parts[1].replace("+", "");
    return `${mantissa}e^${Number(expStr)}`;
  }
}

export { Renderer };
