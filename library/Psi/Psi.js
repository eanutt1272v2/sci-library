p5.disableFriendlyErrors = true;

let appcore;
let colourMaps, font;

const diagnosticsLogger =
  typeof AppDiagnostics !== "undefined" &&
  typeof AppDiagnostics.resolveLogger === "function"
    ? AppDiagnostics.resolveLogger("Psi")
    : { info() {}, warn() {}, error() {}, debug() {} };

if (
  typeof AppDiagnostics !== "undefined" &&
  typeof AppDiagnostics.installGlobalErrorHandlers === "function"
) {
  AppDiagnostics.installGlobalErrorHandlers("Psi", {
    logger: diagnosticsLogger,
  });
}

function createReadbackOptimisedCanvas(widthPx, heightPx) {
  const canvasEl = document.createElement("canvas");
  try {
    canvasEl.getContext("2d", { willReadFrequently: true });
  } catch {
    canvasEl.getContext("2d");
  }
  return createCanvas(widthPx, heightPx, canvasEl);
}

function disposeAppCore() {
  if (!appcore || typeof appcore.dispose !== "function") return;
  appcore.dispose();
  appcore = null;
}

function scheduleStartupInitialisation(task) {
  if (typeof task !== "function") return;

  if (
    typeof AppDiagnostics !== "undefined" &&
    typeof AppDiagnostics.scheduleFrameFriendlyTask === "function"
  ) {
    AppDiagnostics.scheduleFrameFriendlyTask(task, {
      logger: diagnosticsLogger,
      label: "Psi AppCore initialisation",
      timeoutMs: 200,
      useIdle: true,
    });
    return;
  }

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      setTimeout(task, 0);
    });
    return;
  }

  setTimeout(task, 0);
}

const metadata = {
  name: "Psi",
  version: "v2.9.8-dev",
  author: "@eanutt1272.v2",
};

async function setup() {
  try {
    const [loadedFont, loadedColourMaps] = await Promise.all([
      AssetLoader.loadPreferredFont({
        family: "Iosevka",
        woff2Path: "../../_shared/fonts/Iosevka-Regular.woff2",
        ttfPath: "../../_shared/fonts/Iosevka-Regular.ttf",
        logger: diagnosticsLogger,
      }),
      AssetLoader.loadJSONAsset("../../_shared/json/colour-maps.json", {
        logger: diagnosticsLogger,
        label: "Psi colour maps",
      }),
    ]);

    font = loadedFont;
    colourMaps = loadedColourMaps;
  } catch (error) {
    diagnosticsLogger.error("Failed to load startup assets:", error);
    return;
  }

  const canvasSize = min(windowWidth, windowHeight);
  const mainCanvas = createReadbackOptimisedCanvas(canvasSize, canvasSize);

  setupCanvasProperties(mainCanvas);

  scheduleStartupInitialisation(() => {
    disposeAppCore();
    try {
      appcore = new AppCore({
        metadata,
        colourMaps,
        font,
      });
    } catch (error) {
      diagnosticsLogger.error("Failed to initialise AppCore:", error);
      disposeAppCore();
    }
  });
}

window.addEventListener("pagehide", disposeAppCore);

function setupCanvasProperties(canvas) {
  const canvasEl = canvas.elt;

  canvasEl.setAttribute("tabindex", "0");
  setTimeout(() => {
    canvasEl.focus();
  }, 100);

  if (typeof KeyboardUtils?.installCanvasFocusBridge === "function") {
    KeyboardUtils.installCanvasFocusBridge(canvasEl);
  }

  textFont(font || "monospace");
  pixelDensity(1);
  frameRate(120);
}

function draw() {
  if (!appcore) return;
  appcore.update();
  appcore.render();
}

function windowResized() {
  if (!appcore) return;
  appcore.resize();
}

function keyPressed(event) {
  const keyValue = KeyboardUtils.normaliseKey(key || event?.key);
  return appcore ? appcore.handleKeyPressed(keyValue, keyCode, event) : false;
}

function keyReleased(event) {
  const keyValue = KeyboardUtils.normaliseKey(key || event?.key);
  return appcore ? appcore.handleKeyReleased(keyValue, keyCode, event) : false;
}

function mouseWheel(event) {
  return appcore ? appcore.handleWheel(event) : false;
}

function mouseDragged(event) {
  return appcore ? appcore.handlePointer(event) : false;
}

function mouseReleased(event) {
  return appcore ? appcore.handlePointerEnd(event) : false;
}

function touchStarted(event) {
  return appcore ? appcore.handlePointer(event) : false;
}

function touchMoved(event) {
  return appcore ? appcore.handlePointer(event) : false;
}

function touchEnded(event) {
  return appcore ? appcore.handlePointerEnd(event) : false;
}
