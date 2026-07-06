import p5 from "../_shared/lib/p5.esm.min.js";
import { scheduleFrameFriendlyTask } from "../_shared/utils/FrameScheduler.js";
import { AppCore } from "./modules/core/AppCore.js";

p5.disableFriendlyErrors = true;

// Inlined global error handler (see ARCHITECTURE.md's "Error-handling
// convention") — a single plain listener, no custom wrapper/indirection.
window.addEventListener("error", (event) => {
  console.error("[Fluvia] Uncaught error:", event.error || event.message);
});

const metadata = {
  name: "Fluvia",
  version: "v5.5.0-dev",
  author: "@eanutt1272.v2",
};

function createReadbackOptimisedCanvas(p, widthPx, heightPx) {
  const canvasEl = document.createElement("canvas");
  try {
    canvasEl.getContext("2d", { willReadFrequently: true });
  } catch {
    canvasEl.getContext("2d");
  }
  return p.createCanvas(widthPx, heightPx, canvasEl);
}

function setupCanvasProperties(p, canvas, font) {
  const canvasEl = canvas.elt;

  canvasEl.setAttribute("tabindex", "0");
  setTimeout(() => {
    canvasEl.focus();
  }, 100);

  if (typeof KeyboardUtils?.installCanvasFocusBridge === "function") {
    KeyboardUtils.installCanvasFocusBridge(canvasEl);
  }

  p.noSmooth();
  p.textFont(font || "monospace");
  p.pixelDensity(1);
  p.frameRate(120);
}

new p5((p) => {
  let appcore = null;

  function disposeAppCore() {
    if (!appcore || typeof appcore.dispose !== "function") return;
    appcore.dispose();
    appcore = null;
  }

  function scheduleStartupInitialisation(task) {
    if (typeof task !== "function") return;
    scheduleFrameFriendlyTask(task, {
      label: "Fluvia AppCore initialisation",
      timeoutMs: 200,
      useIdle: true,
    });
  }

  p.setup = async () => {
    let font, colourMaps, vertShader, fragShader;

    try {
      const [loadedFont, loadedColourMaps, loadedVertShader, loadedFragShader] =
        await Promise.all([
          AssetLoader.loadPreferredFont({
            family: "Iosevka",
            woff2Path: "../../_shared/fonts/Iosevka-Regular.woff2",
            ttfPath: "../../_shared/fonts/Iosevka-Regular.ttf",
            p,
          }),
          AssetLoader.loadJSONAsset("../../_shared/json/colour-maps.json", {
            label: "Fluvia colour maps",
          }),
          AssetLoader.loadShaderSource("./shaders/fluvia-3d-map.vert.glsl", {
            label: "Fluvia vertex shader",
          }),
          AssetLoader.loadShaderSource("./shaders/fluvia-3d-map.frag.glsl", {
            label: "Fluvia fragment shader",
          }),
        ]);

      font = loadedFont;
      colourMaps = loadedColourMaps;
      vertShader = loadedVertShader;
      fragShader = loadedFragShader;
    } catch (error) {
      console.error("[Fluvia] Failed to load startup assets:", error);
      return;
    }

    const canvasSize = p.min(p.windowWidth, p.windowHeight);
    const mainCanvas = createReadbackOptimisedCanvas(p, canvasSize, canvasSize);

    setupCanvasProperties(p, mainCanvas, font);

    scheduleStartupInitialisation(() => {
      disposeAppCore();
      try {
        appcore = new AppCore(
          { metadata, vertShader, fragShader, colourMaps, font },
          p,
        );
      } catch (error) {
        console.error("[Fluvia] Failed to initialise AppCore:", error);
        disposeAppCore();
      }
    });
  };

  window.addEventListener("pagehide", disposeAppCore);

  // Continuous, unconditional draw loop — preserved exactly from the previous
  // global-mode entry point (no noLoop()/redraw() gating).
  p.draw = () => {
    if (!appcore) return;
    appcore.update();
    appcore.render();
  };

  p.windowResized = () => {
    if (!appcore) return;
    appcore.resize();
  };

  p.keyPressed = (event) => {
    const keyValue = KeyboardUtils.normaliseKey(p.key || event?.key);
    return appcore
      ? appcore.handleKeyPressed(keyValue, p.keyCode, event)
      : false;
  };

  p.keyReleased = (event) => {
    const keyValue = KeyboardUtils.normaliseKey(p.key || event?.key);
    return appcore
      ? appcore.handleKeyReleased(keyValue, p.keyCode, event)
      : false;
  };

  p.mouseWheel = (event) => (appcore ? appcore.handleWheel(event) : false);

  p.mouseDragged = (event) =>
    appcore ? appcore.handlePointer(event) : false;

  p.mousePressed = (event) =>
    appcore ? appcore.handlePointerStart(event) : false;

  p.mouseReleased = (event) =>
    appcore ? appcore.handlePointerEnd(event) : false;

  p.touchStarted = (event) =>
    appcore ? appcore.handlePointerStart(event) : false;

  p.touchMoved = (event) => (appcore ? appcore.handlePointer(event) : false);

  p.touchEnded = (event) =>
    appcore ? appcore.handlePointerEnd(event) : false;
});
