import { scheduleFrameFriendlyTask } from "../_shared/utils/FrameScheduler.js";
import { AppCore } from "./modules/core/AppCore.js";

// `p5` itself is loaded and exposed as a global by index.html's module script
// block (mirroring the existing Tweakpane precedent there), not imported here
// directly — consistent with how `Tweakpane.Pane` is consumed as a bare
// global in GUI.js rather than imported.

p5.disableFriendlyErrors = true;

// Global error/rejection reporting — inlined from the old diagnostics-module
// global-error-handler indirection (now removed), which added no behaviour
// beyond this pair of listeners plus console tagging.
window.addEventListener("error", (event) => {
  console.error("[Psi] Unhandled runtime error", event?.error || event?.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("[Psi] Unhandled promise rejection", event?.reason);
});

const metadata = {
  name: "Psi",
  version: "v2.9.8-dev",
  author: "@eanutt1272.v2",
};

/**
 * Create a `p5.Renderer` backed by a canvas element created with a
 * `willReadFrequently` 2D context hint, so the Renderer's per-frame
 * `loadPixels`/`updatePixels` readback isn't penalised by the browser's
 * default (write-optimised) canvas backing store.
 *
 * @param {import("p5")} p
 * @param {number} widthPx
 * @param {number} heightPx
 * @returns {p5.Renderer}
 */
function createReadbackOptimisedCanvas(p, widthPx, heightPx) {
  const canvasEl = document.createElement("canvas");
  try {
    canvasEl.getContext("2d", { willReadFrequently: true });
  } catch {
    canvasEl.getContext("2d");
  }
  return p.createCanvas(widthPx, heightPx, p.P2D, canvasEl);
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

  p.textFont(font || "monospace");
  p.pixelDensity(1);
  p.frameRate(120);
}

new p5((p) => {
  let appcore;
  let colourMaps, font;

  // Compatibility shim for the shared MediaCore.js/KeyboardUtils.js (frozen —
  // see this repo's _shared/** freeze; not editable from this app).
  // MediaCore.exportImage() calls the bare globals `saveCanvas`/`save`, and
  // KeyboardUtils.isKeyDown() calls the bare global `keyIsDown` — all three
  // only exist when p5 runs in global mode. Instance mode never puts them on
  // `window`, so — following this codebase's existing precedent of a
  // `globalThis.X = X` compatibility bridge for not-yet-migrated consumers
  // (see ARCHITECTURE.md's "Module system & interop") — bind the instance's
  // own methods onto `window` under the same names so these frozen consumers
  // keep working unmodified.
  window.saveCanvas = (...args) => p.saveCanvas(...args);
  window.save = (...args) => p.save(...args);
  window.keyIsDown = (...args) => p.keyIsDown(...args);

  function disposeAppCore() {
    if (!appcore || typeof appcore.dispose !== "function") return;
    appcore.dispose();
    appcore = null;
  }

  window.addEventListener("pagehide", disposeAppCore);

  p.setup = async () => {
    try {
      const [loadedFont, loadedColourMaps] = await Promise.all([
        AssetLoader.loadPreferredFont({
          family: "Iosevka",
          woff2Path: "../../_shared/fonts/Iosevka-Regular.woff2",
          ttfPath: "../../_shared/fonts/Iosevka-Regular.ttf",
          logger: console,
        }),
        AssetLoader.loadJSONAsset("../../_shared/json/colour-maps.json", {
          logger: console,
          label: "Psi colour maps",
        }),
      ]);

      font = loadedFont;
      colourMaps = loadedColourMaps;
    } catch (error) {
      console.error("[Psi] Failed to load startup assets:", error);
      return;
    }

    const canvasSize = p.min(p.windowWidth, p.windowHeight);
    const mainCanvas = createReadbackOptimisedCanvas(p, canvasSize, canvasSize);

    setupCanvasProperties(p, mainCanvas, font);

    scheduleFrameFriendlyTask(
      () => {
        disposeAppCore();
        try {
          appcore = new AppCore({ metadata, colourMaps, font }, p);
        } catch (error) {
          console.error("[Psi] Failed to initialise AppCore:", error);
          disposeAppCore();
        }
      },
      { label: "Psi AppCore initialisation", timeoutMs: 200, useIdle: true },
    );
  };

  // Continuous, unconditional draw loop — matches the pre-rewrite behaviour
  // exactly (no noLoop()/redraw() gating).
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

  p.mouseReleased = (event) =>
    appcore ? appcore.handlePointerEnd(event) : false;

  p.touchStarted = (event) =>
    appcore ? appcore.handlePointer(event) : false;

  p.touchMoved = (event) => (appcore ? appcore.handlePointer(event) : false);

  p.touchEnded = (event) =>
    appcore ? appcore.handlePointerEnd(event) : false;
});
