class InputHandler {
  /**
   * @param {Object} facade - Narrow input dependencies: the live `params` view,
   *   sibling modules (`camera`, `media`, `gui`), discrete AppCore commands
   *   (`generate`, `reset`, `cycleColourMap`, `cycleSurfaceMap`, `refreshGUI`),
   *   and the p5 instance `p`. No AppCore back-reference.
   */
  constructor(facade) {
    this.params = facade.params;
    this.camera = facade.camera;
    this.media = facade.media;
    this.gui = facade.gui;
    this.refreshGUI = facade.refreshGUI;
    this.generate = facade.generate;
    this.reset = facade.reset;
    this.cycleColourMap = facade.cycleColourMap;
    this.cycleSurfaceMap = facade.cycleSurfaceMap;
    this.p = facade.p;

    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false,
      zoomIn: false,
      zoomOut: false,
    };
  }

  handleWheel(event) {
    if (this.canvasInteraction(event)) {
      this.camera.handleWheel(event);
      return false;
    }
  }

  handlePointer(event) {
    if (this.canvasInteraction(event)) {
      this.camera.handlePointer(event);
      return false;
    }
  }

  handlePointerStart(event) {
    if (this.canvasInteraction(event)) {
      this.camera.beginPointer(event);
      this.camera.handlePointer(event);
      return false;
    }
  }

  handlePointerEnd() {
    this.camera.endPointer();
    return false;
  }

  handleKeyPressed(k, kCode, event = null) {
    if (KeyboardUtils.shouldIgnoreKeyboard(event)) {
      return false;
    }

    const keyValue = KeyboardUtils.normaliseKey(k);
    const shiftHeld = Boolean(event?.shiftKey) || KeyboardUtils.isShiftHeld();
    const match = (hintId, optionIndex = null) =>
      typeof KeybindCatalogue !== "undefined" &&
      typeof KeybindCatalogue.matchHint === "function" &&
      KeybindCatalogue.matchHint(
        "fluvia",
        hintId,
        keyValue,
        kCode,
        event,
        optionIndex,
      );
    const matchedTerrainSize =
      typeof KeybindCatalogue !== "undefined" &&
      typeof KeybindCatalogue.matchHintIndex === "function"
        ? KeybindCatalogue.matchHintIndex(
            "fluvia",
            "terrainSize",
            keyValue,
            kCode,
            event,
          )
        : -1;

    if (match("keymapReference")) {
      this.params.renderKeymapRef = !this.params.renderKeymapRef;
      this.refreshGUI();
      return false;
    }

    if (this.params.renderKeymapRef) {
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

    if (match("importHeightmap")) {
      try {
        this.media.openImportDialog();
      } catch (error) {
        console.error("[Fluvia] Import heightmap failed:", error);
      }
      return false;
    }

    if (match("toggleGUI")) {
      if (this.gui && this.gui.pane) {
        this.gui.pane.hidden = !this.gui.pane.hidden;
      }
      return false;
    }

    if (match("running")) {
      this.params.running = !this.params.running;
      this.refreshGUI();
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
        console.error("[Fluvia] Recording toggle failed:", error);
      }
      this.refreshGUI();
      return false;
    }

    if (match("exportImage")) {
      try {
        this.media.exportImage();
      } catch (error) {
        console.error("[Fluvia] Export image failed:", error);
      }
      return false;
    }

    if (match("maxAge", 0) || match("maxAge", 1)) {
      const delta = match("maxAge", 0) ? 16 : -16;
      this.params.maxAge += delta;
      this.refreshGUI();
      return false;
    }

    if (match("minVolume", 0) || match("minVolume", 1)) {
      const delta = match("minVolume", 0) ? 0.001 : -0.001;
      this.params.minVolume += delta;
      this.refreshGUI();
      return false;
    }

    if (matchedTerrainSize >= 0) {
      const terrainSizes = [128, 256, 512];
      this.params.terrainSize = terrainSizes[matchedTerrainSize] || 256;
      this.generate();
      this.refreshGUI();
      return false;
    }

    if (match("noiseScale", 0) || match("noiseScale", 1)) {
      const baseStep = shiftHeld ? 0.25 : 0.05;
      const delta = match("noiseScale", 0) ? -baseStep : baseStep;
      this.params.noiseScale += delta;
      this.refreshGUI();
      return false;
    }

    if (match("noiseOctaves", 0) || match("noiseOctaves", 1)) {
      const delta = match("noiseOctaves", 0) ? -1 : 1;
      this.params.noiseOctaves += delta;
      this.refreshGUI();
      return false;
    }

    if (match("specularIntensity", 0) || match("specularIntensity", 1)) {
      const delta = match("specularIntensity", 0) ? -10 : 10;
      this.params.specularIntensity += delta;
      this.refreshGUI();
      return false;
    }

    if (match("generate")) {
      this.generate();
      this.refreshGUI();
      return false;
    }

    if (match("reset")) {
      if (Boolean(event?.repeat)) {
        return false;
      }
      this.reset();
      this.refreshGUI();
      return false;
    }

    if (match("renderMethod", 0) || match("renderMethod", 1)) {
      this.params.renderMethod = match("renderMethod", 0) ? "2D" : "3D";
      this.refreshGUI();
      return false;
    }

    if (match("overlayStatistics")) {
      this.params.renderStatistics = !this.params.renderStatistics;
      this.refreshGUI();
      return false;
    }

    if (match("overlayLegend")) {
      this.params.renderLegend = !this.params.renderLegend;
      this.refreshGUI();
      return false;
    }

    if (match("colourMap")) {
      this.cycleColourMap(shiftHeld ? -1 : 1);
      this.refreshGUI();
      return false;
    }

    if (match("surfaceMap")) {
      this.cycleSurfaceMap(shiftHeld ? -1 : 1);
      this.refreshGUI();
      return false;
    }

    if (match("heightScale", 0) || match("heightScale", 1)) {
      const delta = match("heightScale", 0)
        ? shiftHeld
          ? -16
          : -4
        : shiftHeld
          ? 16
          : 4;
      this.params.heightScale += delta;
      this.refreshGUI();
      return false;
    }

    if (match("droplets", 0) || match("droplets", 1)) {
      const delta = match("droplets", 0) ? 16 : -16;
      this.params.dropletsPerFrame += delta;
      this.refreshGUI();
      return false;
    }

    if (match("exportWorld")) {
      try {
        this.media.exportWorldJSON();
      } catch (error) {
        console.error("[Fluvia] Export world failed:", error);
      }
      return false;
    }

    if (match("importWorld")) {
      try {
        this.media.importWorldJSON();
      } catch (error) {
        console.error("[Fluvia] Import world failed:", error);
      }
      return false;
    }

    if (match("zoomInCamera")) {
      this.keys.zoomIn = true;
      return false;
    }

    if (match("zoomOutCamera")) {
      this.keys.zoomOut = true;
      return false;
    }

    if (match("orbitUp")) this.keys.up = true;
    if (match("orbitDown")) this.keys.down = true;
    if (match("orbitLeft")) this.keys.left = true;
    if (match("orbitRight")) this.keys.right = true;

    return false;
  }

  handleKeyReleased(k, kCode, event = null) {
    const keyValue = KeyboardUtils.normaliseKey(k);
    const match = (hintId, optionIndex = null) =>
      typeof KeybindCatalogue !== "undefined" &&
      typeof KeybindCatalogue.matchHint === "function" &&
      KeybindCatalogue.matchHint(
        "fluvia",
        hintId,
        keyValue,
        kCode,
        event,
        optionIndex,
      );

    if (match("zoomInCamera")) this.keys.zoomIn = false;
    if (match("zoomOutCamera")) this.keys.zoomOut = false;
    if (match("orbitUp")) this.keys.up = false;
    if (match("orbitDown")) this.keys.down = false;
    if (match("orbitLeft")) this.keys.left = false;
    if (match("orbitRight")) this.keys.right = false;

    return false;
  }

  handleContinuousInput() {
    if (
      KeyboardUtils.shouldIgnoreKeyboard() ||
      this.params.renderKeymapRef ||
      this.params.renderMethod !== "3D"
    ) {
      return;
    }

    const p = this.p;
    const target = this.camera.target;
    const shiftHeld = KeyboardUtils.isShiftHeld();
    const yawStep = shiftHeld ? 0.03 : 0.015;
    const pitchStep = shiftHeld ? 0.03 : 0.015;
    const zoomStep = shiftHeld ? 8 : 4;

    if (this.keys.left) target.yaw -= yawStep;
    if (this.keys.right) target.yaw += yawStep;
    if (this.keys.up)
      target.pitch = p.constrain(target.pitch - pitchStep, -1.56, 1.56);
    if (this.keys.down)
      target.pitch = p.constrain(target.pitch + pitchStep, -1.56, 1.56);
    if (this.keys.zoomIn) target.zoom = p.max(20, target.zoom - zoomStep);
    if (this.keys.zoomOut) target.zoom = p.max(20, target.zoom + zoomStep);
  }

  canvasInteraction(event) {
    if (!event?.target || typeof event.target.closest !== "function")
      return false;

    const { renderMethod } = this.params;
    const { target } = event;

    const is3D = renderMethod === "3D";
    const isUI = target.closest(".tp-dfwv");
    const isCanvas = target.tagName === "CANVAS";

    return is3D && !isUI && isCanvas;
  }
}

export { InputHandler };
