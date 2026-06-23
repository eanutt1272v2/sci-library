class InputHandler {
  constructor(appcore) {
    this.appcore = appcore;
    this._diagnosticsLogger =
      appcore?._diagnosticsLogger ||
      (typeof AppDiagnostics !== "undefined" &&
      typeof AppDiagnostics.resolveLogger === "function"
        ? AppDiagnostics.resolveLogger("Psi")
        : { info() {}, warn() {}, error() {}, debug() {} });
    this.gesture = {
      pan: null,
      pinch: null,
    };
    this._heldKeys = new Set();
  }

  handleContinuousInput() {
    if (
      KeyboardUtils.shouldIgnoreKeyboard() ||
      this.appcore.params.renderKeymapRef
    ) {
      this._heldKeys.clear();
      return;
    }

    const { params } = this.appcore;
    const shiftHeld = KeyboardUtils.isShiftHeld();
    let needsRender = false;
    let syncViewConstraints = false;

    const leftDown = KeyboardUtils.isKeyDown("LEFT_ARROW", 37);
    const rightDown = KeyboardUtils.isKeyDown("RIGHT_ARROW", 39);
    const upDown = KeyboardUtils.isKeyDown("UP_ARROW", 38);
    const downDown = KeyboardUtils.isKeyDown("DOWN_ARROW", 40);

    if (leftDown || rightDown) {
      if (shiftHeld) {
        const step = max(0.25, params.viewRadius * 0.03);
        const delta = rightDown ? step : -step;
        this.panCurrentPlane(delta, 0);
      } else {
        params.sliceOffset = constrain(
          params.sliceOffset + (rightDown ? 0.5 : -0.5),
          -params.viewRadius,
          params.viewRadius,
        );
      }

      needsRender = true;
    }

    if (upDown || downDown) {
      if (shiftHeld) {
        const step = max(0.25, params.viewRadius * 0.03);
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
        params.viewRadius = constrain(params.viewRadius + delta, 1, 256);
        needsRender = true;
        syncViewConstraints = true;
      }
    }

    const sliceDown = this._isHintHeld("sliceOffset", 0);
    const sliceUp = this._isHintHeld("sliceOffset", 1);
    if (sliceDown || sliceUp) {
      const delta = (sliceUp ? 0.5 : 0) - (sliceDown ? 0.5 : 0);
      if (delta !== 0) {
        params.sliceOffset = constrain(
          params.sliceOffset + delta,
          -params.viewRadius,
          params.viewRadius,
        );
        needsRender = true;
      }
    }

    if (shiftHeld) {
      const panStep = max(0.25, params.viewRadius * 0.03);
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
      params.resolution = constrain(
        params.resolution + (isPlus ? 2 : -2),
        64,
        512,
      );
      needsRender = true;
    }

    if (!needsRender) {
      return;
    }

    this.appcore.refreshGUI();

    if (syncViewConstraints) {
      this.appcore.syncViewConstraints();
    } else {
      this.appcore.requestRender();
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
      this.appcore.toggleKeymapRef();
      this.appcore.refreshGUI();
      this._diagnosticsLogger.info(
        `Keymap Reference: ${this.appcore.params.renderKeymapRef}`,
      );
      return false;
    }

    if (KeyboardUtils.shouldIgnoreKeyboard(event)) {
      return false;
    }

    if (this.appcore.params.renderKeymapRef) {
      return false;
    }

    if (match("exportImage")) {
      this.appcore.exportImage();
      return false;
    }

    if (match("record")) {
      try {
        if (this.appcore.media.isRecording) {
          this.appcore.media.stopRecording();
        } else {
          this.appcore.media.startRecording();
        }
      } catch (error) {
        this._diagnosticsLogger.error("Recording toggle failed:", error);
      }
      this.appcore.refreshGUI();
      return false;
    }

    if (match("importParams")) {
      this.appcore.media.importParamsJSON();
      return false;
    }

    if (match("exportParams")) {
      this.appcore.media.exportParamsJSON();
      return false;
    }

    if (match("exportStatistics")) {
      this.appcore.media.exportStatisticsJSON();
      return false;
    }

    if (match("exportStatisticsCsv")) {
      this.appcore.media.exportStatisticsCSV();
      return false;
    }

    let logMsg = "";
    let shouldRefreshGUI = true;

    if (match("nuclearCharge", 0)) {
      this.appcore.params.nuclearCharge = Math.max(
        1,
        Math.min(20, Math.round(this.appcore.params.nuclearCharge + 1)),
      );
      this.appcore.requestRender();
      logMsg = `Z changed to ${this.appcore.params.nuclearCharge}`;
    } else if (match("nuclearCharge", 1)) {
      this.appcore.params.nuclearCharge = Math.max(
        1,
        Math.min(20, Math.round(this.appcore.params.nuclearCharge - 1)),
      );
      this.appcore.requestRender();
      logMsg = `Z changed to ${this.appcore.params.nuclearCharge}`;
    } else if (match("reducedMass")) {
      this.appcore.params.useReducedMass = !this.appcore.params.useReducedMass;
      this.appcore.requestRender();
      logMsg = `Reduced mass: ${this.appcore.params.useReducedMass}`;
    } else if (match("nucleusMass", 0)) {
      const current = Math.log10(this.appcore.params.nucleusMassKg);
      const next = constrain(current + 0.01, -30, -24);
      this.appcore.params.nucleusMassKg = Math.pow(10, next);
      this.appcore.requestRender();
      logMsg = `Nucleus mass log10 = ${next.toFixed(2)}`;
    } else if (match("nucleusMass", 1)) {
      const current = Math.log10(this.appcore.params.nucleusMassKg);
      const next = constrain(current - 0.01, -30, -24);
      this.appcore.params.nucleusMassKg = Math.pow(10, next);
      this.appcore.requestRender();
      logMsg = `Nucleus mass log10 = ${next.toFixed(2)}`;
    } else if (match("quantumN", 0) || match("quantumN", 1)) {
      this.appcore.updateQuantumNumbers("n", match("quantumN", 0) ? 1 : -1);
      logMsg = `n changed to ${this.appcore.params.n}`;
    } else if (match("quantumL", 0) || match("quantumL", 1)) {
      this.appcore.updateQuantumNumbers("l", match("quantumL", 0) ? 1 : -1);
      logMsg = `l changed to ${this.appcore.params.l}`;
    } else if (match("quantumM", 0) || match("quantumM", 1)) {
      this.appcore.updateQuantumNumbers("m", match("quantumM", 0) ? 1 : -1);
      logMsg = `m changed to ${this.appcore.params.m}`;
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
      this.appcore.changePlane(planes[matchedPlane] || "xz");
      logMsg = `Plane switched to ${this.appcore.params.slicePlane.toUpperCase()}`;
    }

    if (match("colourMap")) {
      this.appcore.cycleColourMap();
      logMsg = `Map switched to ${this.appcore.params.colourMap}`;
    } else if (match("overlay")) {
      this.appcore.toggleOverlay();
      logMsg = `Overlay: ${this.appcore.params.renderOverlay}`;
    } else if (match("nodeOverlay")) {
      this.appcore.toggleNodeOverlay();
      logMsg = `Node Overlay: ${this.appcore.params.renderNodeOverlay}`;
    } else if (match("legend")) {
      this.appcore.toggleLegend();
      logMsg = `Legend: ${this.appcore.params.renderLegend}`;
    } else if (match("smoothing")) {
      this.appcore.toggleSmoothing();
      logMsg = `Smoothing: ${this.appcore.params.pixelSmoothing}`;
    } else if (match("toggleGUI")) {
      this.appcore.toggleGUI();
      shouldRefreshGUI = false;
    } else if (match("resetViewCentre")) {
      this.appcore.resetViewCentre();
      logMsg = "View centre reset";
    } else if (match("resetViewRadius")) {
      this.appcore.resetViewRadius();
      logMsg = "View radius reset";
    }

    if (match("resetSliceOffset")) {
      this.appcore.resetSliceOffset();
      logMsg = "Offset reset to 0";
    }

    if (logMsg) {
      this._diagnosticsLogger.info(logMsg);
    }

    if (shouldRefreshGUI) {
      this.appcore.refreshGUI();
    }

    return false;
  }

  handleKeyReleased(k, kCode, event = null) {
    const keyValue = KeyboardUtils.normaliseKey(k);
    this._setHeldKey(keyValue, false, event);
    return false;
  }

  handleWheel(event) {
    if (!this.appcore.canvasInteraction(event)) {
      return;
    }

    const wheelDelta = constrain(event.delta || 0, -80, 80);
    const zoomScale = Math.exp(wheelDelta * 0.001);
    if (
      !this.applyZoomAtNormalisedPoint(
        mouseX / max(1, width),
        mouseY / max(1, height),
        zoomScale,
      )
    ) {
      return false;
    }

    this.appcore.syncViewConstraints();
    return false;
  }

  handlePointer(event) {
    if (!this.appcore.canvasInteraction(event)) {
      return;
    }

    const touchCount = touches.length;

    if (touchCount === 2) {
      this.handlePinch(touches[0], touches[1]);
      return false;
    }

    if (touchCount === 1) {
      this.handlePan(touches[0]);
      return false;
    }

    if (mouseIsPressed) {
      this.handlePan({ x: mouseX, y: mouseY });
      return false;
    }

    this.resetGesture();
  }

  handlePointerEnd(event) {
    const hadActiveGesture = Boolean(this.gesture.pan || this.gesture.pinch);
    const isCanvasInteraction = this.appcore.canvasInteraction(event);
    this.resetGesture();
    if (isCanvasInteraction || hadActiveGesture) {
      this.appcore.refreshGUI();
      return false;
    }
  }

  handlePan(pointer) {
    if (!this.gesture.pan) {
      this.gesture.pan = { x: pointer.x, y: pointer.y };
      this.gesture.pinch = null;
      return;
    }

    const dx = pointer.x - this.gesture.pan.x;
    const dy = pointer.y - this.gesture.pan.y;
    const worldScale = (this.appcore.params.viewRadius * 2) / max(1, width);

    this.panCurrentPlane(-dx * worldScale, -dy * worldScale);

    this.gesture.pan.x = pointer.x;
    this.gesture.pan.y = pointer.y;

    this.appcore.requestRender();
  }

  handlePinch(t1, t2) {
    const distance = dist(t1.x, t1.y, t2.x, t2.y);
    const cx = (t1.x + t2.x) / 2;
    const cy = (t1.y + t2.y) / 2;

    if (!this.gesture.pinch) {
      this.gesture.pinch = { distance };
      this.gesture.pan = null;
      return;
    }

    const ratio = distance / this.gesture.pinch.distance;
    const zoomScale = 1 / max(ratio, 1e-6);
    if (
      !this.applyZoomAtNormalisedPoint(
        cx / max(1, width),
        cy / max(1, height),
        zoomScale,
      )
    ) {
      return;
    }

    this.gesture.pinch.distance = distance;
    this.appcore.syncViewConstraints();
  }

  applyZoomAtNormalisedPoint(nx, ny, zoomScale) {
    const { params } = this.appcore;
    const oldRadius = params.viewRadius;
    const newRadius = constrain(oldRadius * zoomScale, 1, 256);

    if (newRadius === oldRadius) {
      return false;
    }

    const clampedNx = constrain(nx, 0, 1);
    const clampedNy = constrain(ny, 0, 1);
    const { axis1, axis2 } = this.appcore.getPlaneAxes();
    params.viewCentre[axis1] += (clampedNx - 0.5) * (oldRadius - newRadius) * 2;
    params.viewCentre[axis2] += (clampedNy - 0.5) * (oldRadius - newRadius) * 2;
    params.viewRadius = newRadius;

    return true;
  }

  panCurrentPlane(delta1, delta2) {
    const { axis1, axis2 } = this.appcore.getPlaneAxes();
    this.appcore.params.viewCentre[axis1] += delta1;
    this.appcore.params.viewCentre[axis2] += delta2;
  }

  _setHeldKey(value, isHeld, event = null) {
    const keyValue = KeyboardUtils.normaliseKey(value);
    this._syncHeldModifiersFromEvent(event);
    if (!keyValue) return;
    const keyLower = KeyboardUtils.toLower(keyValue);

    if (isHeld) {
      this._heldKeys.add(keyValue);
      this._heldKeys.add(keyLower);
      return;
    }

    this._heldKeys.delete(keyValue);
    this._heldKeys.delete(keyLower);
  }

  _syncHeldModifiersFromEvent(event = null) {
    if (!event || typeof event !== "object") return;

    const modifiers = [
      ["shift", Boolean(event.shiftKey), ["shift"]],
      ["control", Boolean(event.ctrlKey), ["control", "ctrl"]],
      ["alt", Boolean(event.altKey), ["alt", "option"]],
      ["meta", Boolean(event.metaKey), ["meta", "command", "cmd"]],
    ];

    for (const [, isDown, aliases] of modifiers) {
      for (const alias of aliases) {
        if (isDown) {
          this._heldKeys.add(alias);
        } else {
          this._heldKeys.delete(alias);
        }
      }
    }
  }

  _isKeyHeld(...values) {
    return values.some((value) => this._heldKeys.has(value));
  }

  _isHintHeld(hintId, optionIndex = null) {
    return (
      typeof KeybindCatalogue !== "undefined" &&
      typeof KeybindCatalogue.matchHintFromHeldSet === "function" &&
      KeybindCatalogue.matchHintFromHeldSet(
        "psi",
        hintId,
        this._heldKeys,
        optionIndex,
      )
    );
  }

  resetGesture() {
    this.gesture.pan = null;
    this.gesture.pinch = null;
  }
}
