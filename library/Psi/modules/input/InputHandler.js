class InputHandler {
  /**
   * @param {Object} facade - InputHandler's view of AppCore: same shape as
   *   GUI's facade (`store, params, statistics, colourMaps, media, metadata,
   *   requestRender, syncViewConstraints, resetViewRadius, resetSliceOffset,
   *   resetViewCentre`) plus `p` (the p5 instance, for pointer/canvas globals)
   *   and every discrete command method InputHandler dispatches
   *   (`getPlaneAxes, canvasInteraction, updateQuantumNumbers, adjustLogAlpha,
   *   changePlane, cycleColourMap, toggleOverlay, toggleNodeOverlay,
   *   toggleLegend, toggleSmoothing, toggleGUI, toggleKeymapRef, exportImage,
   *   refreshGUI`).
   */
  constructor(facade) {
    this.facade = facade;
    this.store = facade.store;
    this.params = facade.params;
    this.media = facade.media;
    this.p = facade.p;
    this.gesture = {
      pan: null,
      pinch: null,
    };
    this._heldKeys = new Set();
  }

  handleContinuousInput() {
    const p = this.p;
    if (KeyboardUtils.shouldIgnoreKeyboard() || this.params.renderKeymapRef) {
      this._heldKeys.clear();
      return;
    }

    const { params } = this;
    const shiftHeld = KeyboardUtils.isShiftHeld();
    let needsRender = false;
    let syncViewConstraints = false;

    const leftDown = KeyboardUtils.isKeyDown("LEFT_ARROW", 37);
    const rightDown = KeyboardUtils.isKeyDown("RIGHT_ARROW", 39);
    const upDown = KeyboardUtils.isKeyDown("UP_ARROW", 38);
    const downDown = KeyboardUtils.isKeyDown("DOWN_ARROW", 40);

    if (leftDown || rightDown) {
      if (shiftHeld) {
        const step = p.max(0.25, params.viewRadius * 0.03);
        const delta = rightDown ? step : -step;
        this.panCurrentPlane(delta, 0);
      } else {
        params.sliceOffset = p.constrain(
          params.sliceOffset + (rightDown ? 0.5 : -0.5),
          -params.viewRadius,
          params.viewRadius,
        );
      }

      needsRender = true;
    }

    if (upDown || downDown) {
      if (shiftHeld) {
        const step = p.max(0.25, params.viewRadius * 0.03);
        const delta = upDown ? -step : step;
        this.panCurrentPlane(0, delta);
        needsRender = true;
      } else {
        const zoomIn = upDown;
        const zoomOut = downDown;

        if (zoomIn !== zoomOut) {
          const zoomScale = zoomOut ? 1.02 : 0.98;
          if (this.applyZoomAtNormalisedPoint(0.5, 0.5, zoomScale)) {
            needsRender = true;
            syncViewConstraints = true;
          }
        }
      }
    }

    const zoomInDown = this._isHintHeld("viewRadius", 0);
    const zoomOutDown = this._isHintHeld("viewRadius", 1);
    if (zoomInDown || zoomOutDown) {
      const delta = (zoomOutDown ? 0.75 : 0) - (zoomInDown ? 0.75 : 0);
      if (delta !== 0) {
        const { min, max } = this.store.getRange("viewRadius");
        params.viewRadius = p.constrain(params.viewRadius + delta, min, max);
        needsRender = true;
        syncViewConstraints = true;
      }
    }

    const sliceDown = this._isHintHeld("sliceOffset", 0);
    const sliceUp = this._isHintHeld("sliceOffset", 1);
    if (sliceDown || sliceUp) {
      const delta = (sliceUp ? 0.5 : 0) - (sliceDown ? 0.5 : 0);
      if (delta !== 0) {
        params.sliceOffset = p.constrain(
          params.sliceOffset + delta,
          -params.viewRadius,
          params.viewRadius,
        );
        needsRender = true;
      }
    }

    if (shiftHeld) {
      const panStep = p.max(0.25, params.viewRadius * 0.03);
      const panX =
        (this._isHintHeld("panX", 1) ? 1 : 0) -
        (this._isHintHeld("panX", 0) ? 1 : 0);
      const panY =
        (this._isHintHeld("panY", 0) ? 1 : 0) -
        (this._isHintHeld("panY", 1) ? 1 : 0);
      const panZ =
        (this._isHintHeld("panZ", 1) ? 1 : 0) -
        (this._isHintHeld("panZ", 0) ? 1 : 0);

      if (panX || panY || panZ) {
        params.viewCentre.x += panX * panStep;
        params.viewCentre.y += panY * panStep;
        params.viewCentre.z += panZ * panStep;
        needsRender = true;
      }
    }

    const isPlus = this._isHintHeld("resolution", 0);
    const isMinus = this._isHintHeld("resolution", 1);

    if (isPlus || isMinus) {
      const { min, max } = this.store.getRange("resolution");
      params.resolution = p.constrain(
        params.resolution + (isPlus ? 2 : -2),
        min,
        max,
      );
      needsRender = true;
    }

    if (!needsRender) {
      return;
    }

    this.facade.refreshGUI();

    if (syncViewConstraints) {
      this.facade.syncViewConstraints();
    } else {
      this.facade.requestRender();
    }
  }

  handleKeyPressed(k, kCode, event = null) {
    const keyValue = KeyboardUtils.normaliseKey(k);
    this._setHeldKey(keyValue, true, event);

    const match = (hintId, optionIndex = null) =>
      typeof KeybindCatalogue !== "undefined" &&
      typeof KeybindCatalogue.matchHint === "function" &&
      KeybindCatalogue.matchHint(
        "psi",
        hintId,
        keyValue,
        kCode,
        event,
        optionIndex,
      );

    if (match("keymapReference")) {
      this.facade.toggleKeymapRef();
      this.facade.refreshGUI();
      console.info(`[Psi] Keymap Reference: ${this.params.renderKeymapRef}`);
      return false;
    }

    if (KeyboardUtils.shouldIgnoreKeyboard(event)) {
      return false;
    }

    if (this.params.renderKeymapRef) {
      return false;
    }

    if (match("exportImage")) {
      this.facade.exportImage();
      return false;
    }

    if (match("record")) {
      try {
        if (this.media.isRecording) {
          this.media.stopRecording();
        } else {
          this.media.startRecording();
        }
      } catch (error) {
        console.error("[Psi] Recording toggle failed:", error);
      }
      this.facade.refreshGUI();
      return false;
    }

    if (match("importParams")) {
      this.media.importParamsJSON();
      return false;
    }

    if (match("exportParams")) {
      this.media.exportParamsJSON();
      return false;
    }

    if (match("exportStatistics")) {
      this.media.exportStatisticsJSON();
      return false;
    }

    if (match("exportStatisticsCsv")) {
      this.media.exportStatisticsCSV();
      return false;
    }

    let logMsg = "";
    let shouldRefreshGUI = true;

    if (match("nuclearCharge", 0)) {
      this.params.nuclearCharge = Math.max(
        1,
        Math.min(20, Math.round(this.params.nuclearCharge + 1)),
      );
      this.facade.requestRender();
      logMsg = `Z changed to ${this.params.nuclearCharge}`;
    } else if (match("nuclearCharge", 1)) {
      this.params.nuclearCharge = Math.max(
        1,
        Math.min(20, Math.round(this.params.nuclearCharge - 1)),
      );
      this.facade.requestRender();
      logMsg = `Z changed to ${this.params.nuclearCharge}`;
    } else if (match("reducedMass")) {
      this.params.useReducedMass = !this.params.useReducedMass;
      this.facade.requestRender();
      logMsg = `Reduced mass: ${this.params.useReducedMass}`;
    } else if (match("nucleusMass", 0)) {
      const current = Math.log10(this.params.nucleusMassKg);
      const next = this.p.constrain(current + 0.01, -30, -24);
      this.params.nucleusMassKg = Math.pow(10, next);
      this.facade.requestRender();
      logMsg = `Nucleus mass log10 = ${next.toFixed(2)}`;
    } else if (match("nucleusMass", 1)) {
      const current = Math.log10(this.params.nucleusMassKg);
      const next = this.p.constrain(current - 0.01, -30, -24);
      this.params.nucleusMassKg = Math.pow(10, next);
      this.facade.requestRender();
      logMsg = `Nucleus mass log10 = ${next.toFixed(2)}`;
    } else if (match("quantumN", 0) || match("quantumN", 1)) {
      this.facade.updateQuantumNumbers("n", match("quantumN", 0) ? 1 : -1);
      logMsg = `n changed to ${this.params.n}`;
    } else if (match("quantumL", 0) || match("quantumL", 1)) {
      this.facade.updateQuantumNumbers("l", match("quantumL", 0) ? 1 : -1);
      logMsg = `l changed to ${this.params.l}`;
    } else if (match("quantumM", 0) || match("quantumM", 1)) {
      this.facade.updateQuantumNumbers("m", match("quantumM", 0) ? 1 : -1);
      logMsg = `m changed to ${this.params.m}`;
    } else if (match("logAlpha", 0)) {
      // ] — increase log-gamma normalisation alpha by 10
      this.facade.adjustLogAlpha(10);
      logMsg = `Log-gamma alpha = ${this.params.logAlpha}`;
    } else if (match("logAlpha", 1)) {
      // [ — decrease log-gamma normalisation alpha by 10
      this.facade.adjustLogAlpha(-10);
      logMsg = `Log-gamma alpha = ${this.params.logAlpha}`;
    }

    const matchedPlane =
      typeof KeybindCatalogue !== "undefined" &&
      typeof KeybindCatalogue.matchHintIndex === "function"
        ? KeybindCatalogue.matchHintIndex(
            "psi",
            "slicePlane",
            keyValue,
            kCode,
            event,
          )
        : -1;
    if (matchedPlane >= 0) {
      const planes = ["xy", "xz", "yz"];
      this.facade.changePlane(planes[matchedPlane] || "xz");
      logMsg = `Plane switched to ${this.params.slicePlane.toUpperCase()}`;
    }

    if (match("colourMap")) {
      this.facade.cycleColourMap();
      logMsg = `Map switched to ${this.params.colourMap}`;
    } else if (match("overlay")) {
      this.facade.toggleOverlay();
      logMsg = `Overlay: ${this.params.renderOverlay}`;
    } else if (match("nodeOverlay")) {
      this.facade.toggleNodeOverlay();
      logMsg = `Node Overlay: ${this.params.renderNodeOverlay}`;
    } else if (match("legend")) {
      this.facade.toggleLegend();
      logMsg = `Legend: ${this.params.renderLegend}`;
    } else if (match("smoothing")) {
      this.facade.toggleSmoothing();
      logMsg = `Smoothing: ${this.params.pixelSmoothing}`;
    } else if (match("toggleGUI")) {
      this.facade.toggleGUI();
      shouldRefreshGUI = false;
    } else if (match("resetViewCentre")) {
      this.facade.resetViewCentre();
      logMsg = "View centre reset";
    } else if (match("resetViewRadius")) {
      this.facade.resetViewRadius();
      logMsg = "View radius reset";
    }

    if (match("resetSliceOffset")) {
      this.facade.resetSliceOffset();
      logMsg = "Offset reset to 0";
    }

    if (logMsg) {
      console.info(`[Psi] ${logMsg}`);
    }

    if (shouldRefreshGUI) {
      this.facade.refreshGUI();
    }

    return false;
  }

  handleKeyReleased(k, kCode, event = null) {
    const keyValue = KeyboardUtils.normaliseKey(k);
    this._setHeldKey(keyValue, false, event);
    return false;
  }

  handleWheel(event) {
    const p = this.p;
    if (!this.facade.canvasInteraction(event)) {
      return;
    }

    const wheelDelta = p.constrain(event.delta || 0, -80, 80);
    const zoomScale = Math.exp(wheelDelta * 0.001);
    if (
      !this.applyZoomAtNormalisedPoint(
        p.mouseX / p.max(1, p.width),
        p.mouseY / p.max(1, p.height),
        zoomScale,
      )
    ) {
      return false;
    }

    this.facade.syncViewConstraints();
    return false;
  }

  handlePointer(event) {
    const p = this.p;
    if (!this.facade.canvasInteraction(event)) {
      return;
    }

    const touchCount = p.touches.length;

    if (touchCount === 2) {
      this.handlePinch(p.touches[0], p.touches[1]);
      return false;
    }

    if (touchCount === 1) {
      this.handlePan(p.touches[0]);
      return false;
    }

    if (p.mouseIsPressed) {
      this.handlePan({ x: p.mouseX, y: p.mouseY });
      return false;
    }

    this.resetGesture();
  }

  handlePointerEnd(event) {
    const hadActiveGesture = Boolean(this.gesture.pan || this.gesture.pinch);
    const isCanvasInteraction = this.facade.canvasInteraction(event);
    this.resetGesture();
    if (isCanvasInteraction || hadActiveGesture) {
      this.facade.refreshGUI();
      return false;
    }
  }

  handlePan(pointer) {
    const p = this.p;
    if (!this.gesture.pan) {
      this.gesture.pan = { x: pointer.x, y: pointer.y };
      this.gesture.pinch = null;
      return;
    }

    const dx = pointer.x - this.gesture.pan.x;
    const dy = pointer.y - this.gesture.pan.y;
    const worldScale = (this.params.viewRadius * 2) / p.max(1, p.width);

    this.panCurrentPlane(-dx * worldScale, -dy * worldScale);

    this.gesture.pan.x = pointer.x;
    this.gesture.pan.y = pointer.y;

    this.facade.requestRender();
  }

  handlePinch(t1, t2) {
    const p = this.p;
    const distance = p.dist(t1.x, t1.y, t2.x, t2.y);
    const cx = (t1.x + t2.x) / 2;
    const cy = (t1.y + t2.y) / 2;

    if (!this.gesture.pinch) {
      this.gesture.pinch = { distance };
      this.gesture.pan = null;
      return;
    }

    const zoomScale = this.gesture.pinch.distance / Math.max(1, distance);
    if (
      this.applyZoomAtNormalisedPoint(
        cx / p.max(1, p.width),
        cy / p.max(1, p.height),
        zoomScale,
      )
    ) {
      this.facade.syncViewConstraints();
    }

    this.gesture.pinch.distance = distance;
  }

  applyZoomAtNormalisedPoint(nx, ny, zoomScale) {
    const p = this.p;
    const { params } = this;
    const { axis1, axis2 } = this.facade.getPlaneAxes();
    const oldRadius = params.viewRadius;
    const { min, max } = this.store.getRange("viewRadius");
    const newRadius = p.constrain(oldRadius * zoomScale, min, max);
    if (Math.abs(newRadius - oldRadius) < 1e-6) return false;

    const worldX = params.viewCentre[axis1] + (nx * 2 - 1) * oldRadius;
    const worldY = params.viewCentre[axis2] + (ny * 2 - 1) * oldRadius;

    params.viewRadius = newRadius;
    params.viewCentre[axis1] = worldX - (nx * 2 - 1) * newRadius;
    params.viewCentre[axis2] = worldY - (ny * 2 - 1) * newRadius;

    return true;
  }

  panCurrentPlane(dx, dy) {
    const { params } = this;
    const { axis1, axis2 } = this.facade.getPlaneAxes();
    params.viewCentre[axis1] += dx;
    params.viewCentre[axis2] += dy;
  }

  resetGesture() {
    this.gesture.pan = null;
    this.gesture.pinch = null;
  }

  _isHintHeld(hintId, optionIndex = 0) {
    if (
      typeof KeybindCatalogue === "undefined" ||
      typeof KeybindCatalogue.getHintKey === "function" === false
    ) {
      return false;
    }
    const key = KeybindCatalogue.getHintKey("psi", hintId, optionIndex);
    return key ? this._heldKeys.has(key) : false;
  }

  _setHeldKey(keyValue, down, event) {
    if (!keyValue) return;
    if (down) {
      this._heldKeys.add(keyValue);
    } else {
      this._heldKeys.delete(keyValue);
    }
  }
}

export { InputHandler };
