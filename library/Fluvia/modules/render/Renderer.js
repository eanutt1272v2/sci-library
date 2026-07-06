import { ColourMapLUT } from "../../../_shared/utils/ColourMapLUT.js";

class Renderer {
  /**
   * @param {Object} facade - Narrow render dependencies: `params`, `statistics`,
   *   `colourMaps`, `metadata`, `shaders`, `refreshGUI`, live `terrain`/`camera`
   *   getters, and the p5 instance `p`. No AppCore back-reference.
   */
  constructor(facade) {
    this._facade = facade;
    this.params = facade.params;
    this.statistics = facade.statistics;
    this.colourMaps = facade.colourMaps;
    this.shaders = facade.shaders;
    this.refreshGUI = facade.refreshGUI;
    this.p = facade.p;

    const p = this.p;

    this.canvas3D = p.createGraphics(p.width, p.height, p.WEBGL);
    this._warned3DFallback = false;
    this.terrainShader =
      this.canvas3D && typeof this.canvas3D.createShader === "function"
        ? this.canvas3D.createShader(this.shaders.vert, this.shaders.frag)
        : null;

    const { size } = this.terrain;
    this.canvas2D = this._createReadbackBuffer(size, size);
    this.heightMapTexture = this._createReadbackBuffer(size, size);

    this.lut = new Uint8ClampedArray(256 * 3);
    this.currentColourMap = "";
    this.textureUpdateIntervalMs = 50;
    this.lastTextureUpdateMs = 0;
    this.textureDirty = true;
    this.lastLegendRange = null;
    this.compositeLegendItems = [
      { l: "Water", cKey: "waterColour" },
      { l: "Sediment", cKey: "sedimentColour" },
      { l: "Flat", cKey: "flatColour" },
      { l: "Steep", cKey: "steepColour" },
    ];
    this.keymapSections = KeybindCatalogue.getSections("fluvia");
  }

  get terrain() {
    return this._facade.terrain;
  }

  get camera() {
    return this._facade.camera;
  }

  // Live, not a snapshot: metadata can be reassigned (not just mutated) by a
  // params/world JSON import (see MediaCore._applyMetadataSnapshot), and
  // renderKeymapRef() must reflect that on its next call, matching the
  // original pre-rewrite code's behaviour of reading the owner's metadata
  // field live on every call rather than caching it at construction time.
  get metadata() {
    return this._facade.metadata;
  }

  _createReadbackBuffer(widthPx, heightPx) {
    const canvasEl = document.createElement("canvas");
    try {
      canvasEl.getContext("2d", { willReadFrequently: true });
    } catch {
      canvasEl.getContext("2d");
    }

    const buffer = this.p.createGraphics(widthPx, heightPx, canvasEl);
    if (typeof buffer.pixelDensity === "function") {
      buffer.pixelDensity(1);
    }
    if (typeof buffer.noSmooth === "function") {
      buffer.noSmooth();
    }
    return buffer;
  }

  _getRenderer3D() {
    const renderer = this.canvas3D?._renderer;
    return renderer && renderer.isP3D ? renderer : null;
  }

  _canRender3D() {
    const renderer3D = this._getRenderer3D();
    return (
      renderer3D &&
      this.canvas3D &&
      this.terrainShader &&
      typeof this.canvas3D.shader === "function" &&
      typeof this.canvas3D.plane === "function" &&
      typeof renderer3D.camera === "function" &&
      typeof renderer3D.perspective === "function"
    );
  }

  _apply3DCamera(eye, up) {
    const p = this.p;
    const renderer3D = this._getRenderer3D();
    if (!renderer3D) {
      return false;
    }

    const aspect = p.width / p.max(1, p.height);
    renderer3D.perspective(p.PI / 3, aspect, 0.1, 30000);
    renderer3D.camera(eye.x, eye.y, eye.z, 0, 0, 0, up.x, up.y, up.z);
    return true;
  }

  reinitialise() {
    const { size } = this.terrain;
    if (this.canvas2D && typeof this.canvas2D.remove === "function") {
      this.canvas2D.remove();
    }
    if (
      this.heightMapTexture &&
      typeof this.heightMapTexture.remove === "function"
    ) {
      this.heightMapTexture.remove();
    }
    this.canvas2D = this._createReadbackBuffer(size, size);
    this.heightMapTexture = this._createReadbackBuffer(size, size);
    this.textureDirty = true;
  }

  _adaptTextureInterval(renderCostMs) {
    if (renderCostMs > 32) {
      this.textureUpdateIntervalMs = 100;
      return;
    }

    if (renderCostMs > 24) {
      this.textureUpdateIntervalMs = 80;
      return;
    }

    if (renderCostMs > 16) {
      this.textureUpdateIntervalMs = 66;
      return;
    }

    if (renderCostMs < 10) {
      this.textureUpdateIntervalMs = 40;
      return;
    }

    this.textureUpdateIntervalMs = 50;
  }

  updateLUT(colourMap) {
    if (this.currentColourMap === colourMap) return;

    const colourData = this.colourMaps[colourMap];
    if (!colourData) return;

    this.currentColourMap = colourMap;
    ColourMapLUT.buildLUT(this.p, colourData, this.lut);
  }

  _samplePolyMapColour(mapName, t) {
    const map = this.colourMaps?.[mapName];
    return ColourMapLUT.sampleColour(this.p, map, t);
  }

  _sampleDeltaDivergentColour(t) {
    const centre = 236;
    const a = this.p.constrain(t, 0, 1);
    const distance = Math.abs(a - 0.5) * 2;

    let sideColour;
    if (a < 0.5) {
      sideColour = this._samplePolyMapColour("mako", 1 - a * 2);
    } else {
      sideColour = this._samplePolyMapColour("plasma", (a - 0.5) * 2);
    }

    return [
      Math.round(centre * (1 - distance) + sideColour[0] * distance),
      Math.round(centre * (1 - distance) + sideColour[1] * distance),
      Math.round(centre * (1 - distance) + sideColour[2] * distance),
    ];
  }

  generateTextures(is3D) {
    const p = this.p;
    const { params } = this;
    const terrain = this.terrain;
    const camera = this.camera;
    const {
      surfaceMap,
      lightDir,
      flatColour,
      steepColour,
      sedimentColour,
      waterColour,
      skyColour,
      specularIntensity,
      heightScale,
    } = params;

    const { size, area, heightMap, originalHeightMap, sedimentMap } = terrain;

    if (surfaceMap !== "composite") {
      this.updateLUT(params.colourMap || "viridis");
    }

    const lightMag =
      Math.sqrt(lightDir.x ** 2 + lightDir.y ** 2 + lightDir.z ** 2) || 1;
    const lX = lightDir.x / lightMag;
    const lY = lightDir.y / lightMag;
    const lZ = lightDir.z / lightMag;

    let vX = 0,
      vY = 1,
      vZ = 0;
    if (is3D) {
      const v = camera.getViewDirection();
      vX = v.x;
      vY = v.y;
      vZ = v.z;
    }

    const bounds = this.calculateBounds(surfaceMap);
    let fieldMin = Number.POSITIVE_INFINITY;
    let fieldMax = Number.NEGATIVE_INFINITY;

    this.canvas2D.loadPixels();
    this.heightMapTexture.loadPixels();

    for (let i = 0; i < area; i++) {
      const idx = i << 2;
      const hVal = heightMap[i];

      const hByte = (hVal * 255) | 0;
      this.heightMapTexture.pixels[idx] = hByte;
      this.heightMapTexture.pixels[idx + 1] = hByte;
      this.heightMapTexture.pixels[idx + 2] = hByte;
      this.heightMapTexture.pixels[idx + 3] = 255;

      let r, g, b;

      if (surfaceMap === "composite") {
        const x = i % size;
        const y = (i / size) | 0;
        const normal = terrain.getSurfaceNormal(x, y, heightScale);

        const dot = normal.x * lX + normal.y * lY + normal.z * lZ;
        const diffuse = Math.max(0, dot);
        const sW = normal.y * 0.5 + 0.5;

        const shR = diffuse + skyColour.r * 0.000588 * sW;
        const shG = diffuse + skyColour.g * 0.000588 * sW;
        const shB = diffuse + skyColour.b * 0.000588 * sW;

        const steep = 1 - normal.y;
        r = (normal.y * flatColour.r + steep * steepColour.r) * shR;
        g = (normal.y * flatColour.g + steep * steepColour.g) * shG;
        b = (normal.y * flatColour.b + steep * steepColour.b) * shB;

        const sed = sedimentMap[i];
        if (sed > 0) {
          const a = Math.min(1, sed * 5);
          r = (1 - a) * r + a * sedimentColour.r * shR;
          g = (1 - a) * g + a * sedimentColour.g * shG;
          b = (1 - a) * b + a * sedimentColour.b * shB;
        }

        const dis = terrain.getDischarge(i);
        if (dis > 0) {
          const a = Math.min(1, dis);
          const s = Math.max(0.3, 1 - dis * 0.25);

          r = (1 - a) * r + a * waterColour.r * s * shR;
          g = (1 - a) * g + a * waterColour.g * s * shG;
          b = (1 - a) * b + a * waterColour.b * s * shB;

          if (is3D) {
            const hX = lX + vX,
              hY = lY + vY,
              hZ = lZ + vZ;
            const hM = Math.sqrt(hX * hX + hY * hY + hZ * hZ) || 1;
            const ndotH = Math.max(
              0,
              (normal.x * hX + normal.y * hY + normal.z * hZ) / hM,
            );
            const spec = Math.pow(ndotH, 120) * (specularIntensity || 255) * a;

            r = Math.min(255, r + spec);
            g = Math.min(255, g + spec);
            b = Math.min(255, b + spec);
          }
        }
      } else {
        let v = 0;
        let rawFieldValue = 0;
        if (surfaceMap === "height") {
          rawFieldValue = hVal;
          v = (hVal - bounds.min) / bounds.range;
        } else if (surfaceMap === "slope") {
          rawFieldValue =
            1 - terrain.getSurfaceNormal(i % size, (i / size) | 0, heightScale).y;
          v = rawFieldValue;
        } else if (surfaceMap === "discharge") {
          rawFieldValue = terrain.getDischarge(i);
          v = rawFieldValue;
        } else if (surfaceMap === "sediment") {
          rawFieldValue = sedimentMap[i];
          v = (sedimentMap[i] - bounds.min) / bounds.range;
        } else if (surfaceMap === "delta") {
          rawFieldValue = hVal - originalHeightMap[i];
          v = (rawFieldValue - bounds.min) / bounds.range;
        }

        if (Number.isFinite(rawFieldValue)) {
          if (rawFieldValue < fieldMin) fieldMin = rawFieldValue;
          if (rawFieldValue > fieldMax) fieldMax = rawFieldValue;
        }

        const lIdx = p.constrain((v * 255) | 0, 0, 255) * 3;
        r = this.lut[lIdx];
        g = this.lut[lIdx + 1];
        b = this.lut[lIdx + 2];
      }

      this.canvas2D.pixels[idx] = r;
      this.canvas2D.pixels[idx + 1] = g;
      this.canvas2D.pixels[idx + 2] = b;
      this.canvas2D.pixels[idx + 3] = 255;
    }

    this.canvas2D.updatePixels();
    this.heightMapTexture.updatePixels();

    if (surfaceMap !== "composite") {
      const fallbackMin = Number.isFinite(bounds.min) ? bounds.min : 0;
      const fallbackMax = Number.isFinite(bounds.max)
        ? bounds.max
        : fallbackMin + (Number.isFinite(bounds.range) ? bounds.range : 1);
      this.lastLegendRange = {
        map: surfaceMap,
        min: Number.isFinite(fieldMin) ? fieldMin : fallbackMin,
        max: Number.isFinite(fieldMax) ? fieldMax : fallbackMax,
      };
    } else {
      this.lastLegendRange = null;
    }
  }

  calculateBounds(mode) {
    const terrain = this.terrain;

    if (mode === "height") {
      const bounds = terrain.getMapBounds(terrain.heightMap);
      return {
        min: bounds.min,
        max: bounds.max,
        range: bounds.max - bounds.min || 1,
      };
    }

    if (mode === "discharge") {
      const bounds = terrain.getDischargeBounds();
      return {
        min: bounds.min,
        max: bounds.max,
        range: bounds.max - bounds.min || 1,
      };
    }

    if (mode === "sediment") {
      const bounds = terrain.getMapBounds(terrain.sedimentMap);
      return {
        min: bounds.min,
        max: bounds.max,
        range: bounds.max - bounds.min || 1,
      };
    }

    if (mode === "delta") {
      const { area, heightMap, originalHeightMap } = terrain;
      if (!area || !heightMap || !originalHeightMap) {
        return { min: -0.05, max: 0.05, range: 0.1 };
      }

      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < area; i++) {
        const d = heightMap[i] - originalHeightMap[i];
        if (d < min) min = d;
        if (d > max) max = d;
      }

      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return { min: -0.05, max: 0.05, range: 0.1 };
      }

      return { min, max, range: max - min || 1 };
    }

    return { min: 0, max: 1, range: 1 };
  }

  render() {
    const p = this.p;
    const terrain = this.terrain;
    if (
      !terrain ||
      !terrain.heightMap ||
      !terrain.sedimentMap ||
      !terrain.dischargeMap
    ) {
      if (this.params.renderMethod === "3D" && this.canvas3D) {
        p.image(this.canvas3D, 0, 0, p.width, p.height);
      } else {
        p.image(this.canvas2D, 0, 0, p.width, p.height);
      }
      this.renderOverlay();
      return;
    }

    let is3D = this.params.renderMethod === "3D";
    if (is3D && !this._canRender3D()) {
      if (!this._warned3DFallback) {
        console.warn(
          "[Fluvia] WebGL graphics API unavailable, falling back to 2D rendering",
        );
        this._warned3DFallback = true;
      }
      this.params.renderMethod = "2D";
      this.refreshGUI();
      is3D = false;
    }

    const nowMs = performance.now();
    const shouldUpdateTexture =
      this.textureDirty ||
      (this.params.running &&
        nowMs - this.lastTextureUpdateMs >= this.textureUpdateIntervalMs);

    if (shouldUpdateTexture) {
      const startMs = performance.now();
      this.generateTextures(is3D);
      const costMs = performance.now() - startMs;
      this.lastTextureUpdateMs = nowMs;
      this.textureDirty = false;
      this._adaptTextureInterval(costMs);
    }

    if (is3D) {
      this.render3D();
    } else {
      this.render2D();
    }

    this.renderOverlay();
  }

  render2D() {
    const p = this.p;
    p.image(this.canvas2D, 0, 0, p.width, p.height);
  }

  render3D() {
    const p = this.p;
    const { canvas3D, terrainShader, heightMapTexture, canvas2D } = this;
    if (!this._canRender3D()) {
      this.render2D();
      return;
    }

    const terrain = this.terrain;
    const { skyColour, heightScale } = this.params;
    const camera = this.camera;
    const eye = camera.getEyePosition();
    const up = camera.getUpVector();

    canvas3D.background(skyColour.r, skyColour.g, skyColour.b);

    canvas3D.push();
    canvas3D.resetMatrix();
    if (!this._apply3DCamera(eye, up)) {
      canvas3D.pop();
      this.render2D();
      return;
    }

    canvas3D.noStroke();
    canvas3D.shader(terrainShader);
    terrainShader.setUniform("uHeightMap", heightMapTexture);
    terrainShader.setUniform("uTexture", canvas2D);
    terrainShader.setUniform("uHeightScale", heightScale);

    const pSize = terrain.size * 2;
    canvas3D.plane(pSize, pSize, terrain.size - 1, terrain.size - 1);
    canvas3D.pop();

    p.image(canvas3D, 0, 0, p.width, p.height);
  }

  renderOverlay() {
    if (this.params.renderStatistics) this.renderStatistics();
    if (this.params.renderLegend) this.renderLegend();
    if (this.params.renderKeymapRef) this.renderKeymapRef();
  }

  renderStatistics() {
    const p = this.p;
    const { statistics, params } = this;
    const fmt = (value, fixed = 3) => {
      const n = Number(value) || 0;
      const abs = Math.abs(n);
      if (abs > 0 && abs < Math.pow(10, -fixed)) {
        const [mantissa, exponent] = n.toExponential(2).split("e");
        return `${mantissa}e^${Number(exponent)}`;
      }
      return n.toFixed(fixed);
    };
    const lines = [
      `FPS=${fmt(statistics.fps, 1)} [Hz]`,
      `Simulation Time=${fmt(statistics.simulationTime, 1)} [s]`,
      `Frame=${Math.round(statistics.frameCounter)} [frame]`,
      `Running: ${params.running ? "true" : "false"}`,
      `Terrain Size=${Math.round(params.terrainSize)}² [cells]`,
      `Droplets/Frame=${Math.round(params.dropletsPerFrame)} [drops/frame]`,
      `Render Mode: ${params.renderMethod} (mode id)`,
      `Surface Map: ${params.surfaceMap} (surface id)`,
      `Colour Map: ${params.colourMap} (palette id)`,
      `Elevation Mean=${fmt(statistics.avgElevation, 3)} [height]`,
      `Elevation Std Dev=${fmt(statistics.elevationStdDev, 3)} [height]`,
      `Elevation Minimum=${fmt(statistics.heightBounds.min, 3)} [height]`,
      `Elevation Maximum=${fmt(statistics.heightBounds.max, 3)} [height]`,
      `Rugosity Index=${fmt(statistics.rugosity, 3)} [index]`,
      `Slope Complexity Index=${fmt(statistics.slopeComplexity, 3)} [index]`,
      `Water Total=${fmt(statistics.totalWater, 2)} [volume]`,
      `Active Water Cells=${fmt(statistics.activeWaterCover, 2)} [cells]`,
      `Comp Water=${fmt(statistics.compositeWaterCoveragePct, 1)} [%]`,
      `Comp Sediment=${fmt(statistics.compositeSedimentCoveragePct, 1)} [%]`,
      `Comp Flat=${fmt(statistics.compositeFlatCoveragePct, 1)} [%]`,
      `Comp Steep=${fmt(statistics.compositeSteepCoveragePct, 1)} [%]`,
      `Hydraulic Residence=${fmt(statistics.hydraulicResidence, 2)} [s]`,
      `Drainage Density=${fmt(statistics.drainageDensity, 2)} [%]`,
      `Discharge Minimum (norm)=${fmt(statistics.dischargeBounds.min, 3)} [norm]`,
      `Discharge Maximum (norm)=${fmt(statistics.dischargeBounds.max, 3)} [norm]`,
      `Sediment Total=${fmt(statistics.totalSediment, 2)} [volume]`,
      `Bedrock Total=${fmt(statistics.totalBedrock, 2)} [volume]`,
      `Sediment Flux=${fmt(statistics.sedimentFlux, 3)} [volume/s]`,
      `Erosion Rate=${fmt(statistics.erosionRate, 3)} [volume/s]`,
    ];

    p.push();
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(12);
    p.noStroke();
    const panelX = 20;
    const panelY = 20;
    p.fill(255);
    p.text(lines.join("\n"), panelX, panelY);
    p.pop();
  }

  renderLegend() {
    const p = this.p;
    const drawingContext = p.drawingContext;
    p.push();
    const { surfaceMap, colourMap } = this.params;
    const legendTitleByMap = {
      composite: "Composite surface blend",
      height: "Terrain elevation",
      slope: "Slope magnitude",
      discharge: "Water discharge",
      sediment: "Sediment depth",
      delta: "Relative relief (delta)",
    };
    const legendTitle = legendTitleByMap[surfaceMap] || "Surface field";

    if (surfaceMap === "composite") {
      const params = this.params;
      const s = this.statistics;
      const metrics = {
        contributionPct: {
          waterColour: Number(s.compositeWaterCoveragePct) || 0,
          sedimentColour: Number(s.compositeSedimentCoveragePct) || 0,
          flatColour: Number(s.compositeFlatCoveragePct) || 0,
          steepColour: Number(s.compositeSteepCoveragePct) || 0,
        },
        meanControls: {
          slope: Number(s.compositeMeanSlopeWeight) || 0,
          sediment: Number(s.compositeMeanSedimentAlpha) || 0,
          discharge: Number(s.compositeMeanWaterAlpha) || 0,
        },
      };
      const anchors = [
        { l: "Water", cKey: "waterColour", t: 0.1 },
        { l: "Sediment", cKey: "sedimentColour", t: 0.34 },
        { l: "Flat", cKey: "flatColour", t: 0.66 },
        { l: "Steep", cKey: "steepColour", t: 0.9 },
      ];
      // Resolve each colour once — cKey lookups below used to re-read the
      // params proxy per anchor per frame (plus twice more for the first/
      // last stops), for the same handful of keys every time.
      const colourByKey = {
        waterColour: params.waterColour,
        sedimentColour: params.sedimentColour,
        flatColour: params.flatColour,
        steepColour: params.steepColour,
      };

      const x = p.width - 20;
      const y1 = 20;
      const y2 = p.height - 20;
      const w = 15;
      const h = y2 - y1;

      const grad = drawingContext.createLinearGradient(0, y1, 0, y2);
      const stops = anchors
        .map((anchor) => ({ stop: 1 - anchor.t, cKey: anchor.cKey }))
        .sort((a, b) => a.stop - b.stop);

      const firstColour = colourByKey[stops[0].cKey];
      const lastColour = colourByKey[stops[stops.length - 1].cKey];
      grad.addColorStop(
        0,
        `rgb(${firstColour.r}, ${firstColour.g}, ${firstColour.b})`,
      );
      stops.forEach((stop) => {
        const c = colourByKey[stop.cKey];
        grad.addColorStop(stop.stop, `rgb(${c.r}, ${c.g}, ${c.b})`);
      });
      grad.addColorStop(
        1,
        `rgb(${lastColour.r}, ${lastColour.g}, ${lastColour.b})`,
      );

      p.noStroke();
      drawingContext.fillStyle = grad;
      drawingContext.fillRect(x - w, y1, w, h);

      p.noFill();
      p.stroke(255, 255, 255, 200);
      p.strokeWeight(1.5);
      p.rect(x - w, y1, w, h);

      p.fill(255);
      p.noStroke();
      p.textSize(11);
      p.textAlign(p.RIGHT, p.CENTER);
      anchors.forEach((anchor) => {
        const y = y2 - anchor.t * h;
        const pct = metrics.contributionPct[anchor.cKey] || 0;
        p.text(`${anchor.l} ${pct.toFixed(1)}%`, x - w - 6, y);
        p.stroke(255, 255, 255, 150);
        p.strokeWeight(1);
        p.line(x - w - 3, y, x - w, y);
      });

      p.noStroke();
      p.fill(255);
      p.push();
      p.translate(x + w * 0.5, y1 + h * 0.5);
      p.rotate(-p.HALF_PI);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(12);
      p.text(legendTitle, 0, 0);
      p.pop();

      p.pop();
      return;
    }

    const x = p.width - 20;
    const y1 = 20;
    const y2 = p.height - 20;
    const w = 15;
    const h = y2 - y1;

    const grad = drawingContext.createLinearGradient(0, y1, 0, y2);
    this.updateLUT(colourMap || "viridis");
    const stops = 32;
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      const idx = (((1 - t) * 255) | 0) * 3;
      grad.addColorStop(
        t,
        `rgb(${this.lut[idx]}, ${this.lut[idx + 1]}, ${this.lut[idx + 2]})`,
      );
    }

    p.noStroke();
    drawingContext.fillStyle = grad;
    drawingContext.fillRect(x - w, y1, w, h);

    p.noFill();
    p.stroke(255, 255, 255, 200);
    p.strokeWeight(1.5);
    p.rect(x - w, y1, w, h);

    p.fill(255);
    p.noStroke();
    p.textSize(11);
    p.textAlign(p.RIGHT, p.CENTER);

    const b =
      this.lastLegendRange && this.lastLegendRange.map === surfaceMap
        ? {
            min: this.lastLegendRange.min,
            max: this.lastLegendRange.max,
            range: this.lastLegendRange.max - this.lastLegendRange.min,
          }
        : this.calculateBounds(surfaceMap);
    const safeRange = Number.isFinite(b.range) && b.range !== 0 ? b.range : 1;
    const minV = Number.isFinite(b.min) ? b.min : 0;

    const labels = [
      { v: minV + safeRange * 1.0, y: y1 },
      { v: minV + safeRange * 0.75, y: y1 + h * 0.25 },
      { v: minV + safeRange * 0.5, y: y1 + h * 0.5 },
      { v: minV + safeRange * 0.25, y: y1 + h * 0.75 },
      { v: minV, y: y2 },
    ];

    labels.forEach((l) => {
      p.noStroke();
      p.text(l.v.toFixed(3), x - w - 6, l.y);
      p.stroke(255, 255, 255, 150);
      p.strokeWeight(1);
      p.line(x - w - 3, l.y, x - w, l.y);
    });

    p.noStroke();
    p.fill(255);
    p.push();
    p.translate(x + w * 0.5, y1 + h * 0.5);
    p.rotate(-p.HALF_PI);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(12);
    p.text(legendTitle, 0, 0);
    p.pop();

    p.pop();
  }

  renderKeymapRef() {
    const { name, version } = this.metadata;
    KeymapRenderer.render(name, version, this.keymapSections);
  }

  resize() {
    const p = this.p;
    const s = Math.min(p.windowWidth, p.windowHeight);
    if (this.canvas3D) {
      this.canvas3D.resizeCanvas(s, s);
    }
    this.textureDirty = true;
  }

  dispose() {
    if (this.canvas3D && typeof this.canvas3D.remove === "function") {
      this.canvas3D.remove();
    }
    if (this.canvas2D && typeof this.canvas2D.remove === "function") {
      this.canvas2D.remove();
    }
    if (
      this.heightMapTexture &&
      typeof this.heightMapTexture.remove === "function"
    ) {
      this.heightMapTexture.remove();
    }
    this.canvas3D = null;
    this.canvas2D = null;
    this.heightMapTexture = null;
    this.calcPanelImage = null;
  }
}

export { Renderer };
