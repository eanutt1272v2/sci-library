class KeyboardUtils {
  static _modifierState = {
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
  };

  static _modifierTrackingInstalled = false;

  static keyCode(name, fallback) {
    const maybe = globalThis[name];
    const numeric = Number(maybe);
    if (Number.isFinite(numeric)) return numeric;
    return fallback;
  }

  static isKeyCode(code, name, fallback) {
    return Number(code) === KeyboardUtils.keyCode(name, fallback);
  }

  static isKeyDown(name, fallback) {
    if (typeof keyIsDown !== "function") return false;
    return keyIsDown(KeyboardUtils.keyCode(name, fallback));
  }

  static isEnterOrReturn(code) {
    const numeric = Number(code);
    return (
      numeric === 13 ||
      KeyboardUtils.isKeyCode(numeric, "ENTER", 13) ||
      KeyboardUtils.isKeyCode(numeric, "RETURN", 13)
    );
  }

  static isBackspaceOrDelete(code) {
    const numeric = Number(code);
    return (
      KeyboardUtils.isKeyCode(numeric, "BACKSPACE", 8) ||
      KeyboardUtils.isKeyCode(numeric, "DELETE", 46)
    );
  }

  static normaliseKey(value) {
    return typeof value === "string" ? value : "";
  }

  static _setModifierStateFromEvent(event) {
    if (!event || typeof event !== "object") return;
    KeyboardUtils._modifierState.shift = Boolean(event.shiftKey);
    KeyboardUtils._modifierState.ctrl = Boolean(event.ctrlKey);
    KeyboardUtils._modifierState.alt = Boolean(event.altKey);
    KeyboardUtils._modifierState.meta = Boolean(event.metaKey);
  }

  static _resetModifierState() {
    KeyboardUtils._modifierState.shift = false;
    KeyboardUtils._modifierState.ctrl = false;
    KeyboardUtils._modifierState.alt = false;
    KeyboardUtils._modifierState.meta = false;
  }

  static _ensureModifierTracking() {
    if (KeyboardUtils._modifierTrackingInstalled) return;
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const sync = (event) => KeyboardUtils._setModifierStateFromEvent(event);
    const reset = () => KeyboardUtils._resetModifierState();

    window.addEventListener("keydown", sync, true);
    window.addEventListener("keyup", sync, true);
    window.addEventListener("blur", reset, true);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          reset();
        }
      },
      true,
    );

    KeyboardUtils._modifierTrackingInstalled = true;
  }

  static toLower(value) {
    return KeyboardUtils.normaliseKey(value).toLowerCase();
  }

  static isTypingTarget(element) {
    if (!element) return false;

    const tag = (element.tagName || "").toUpperCase();
    if (!!element.isContentEditable) return true;
    if (tag === "TEXTAREA") {
      return !element.disabled && !element.readOnly;
    }
    if (tag !== "INPUT") return false;

    if (element.disabled || element.readOnly) return false;

    const type = String(element.type || "text").toLowerCase();
    return (
      type === "text" ||
      type === "search" ||
      type === "url" ||
      type === "tel" ||
      type === "email" ||
      type === "password" ||
      type === "number"
    );
  }

  static shouldIgnoreKeyboard(event = null) {
    if (event && KeyboardUtils.isTypingTarget(event.target)) return true;
    return KeyboardUtils.isTypingTarget(document.activeElement);
  }

  static _safeFocus(element) {
    if (!element || typeof element.focus !== "function") return;
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }

  static installCanvasFocusBridge(canvasElement) {
    if (!canvasElement || typeof document === "undefined") return () => {};

    if (!KeyboardUtils._canvasFocusBridges) {
      KeyboardUtils._canvasFocusBridges = new WeakMap();
    }

    const existing = KeyboardUtils._canvasFocusBridges.get(canvasElement);
    if (existing) return existing;

    const isCanvasTarget = (target) =>
      target === canvasElement ||
      (typeof canvasElement.contains === "function" &&
        canvasElement.contains(target));

    const isTypingTargetOrAncestor = (target) => {
      if (KeyboardUtils.isTypingTarget(target)) return true;
      if (!target || typeof target.closest !== "function") return false;
      const editableAncestor = target.closest(
        "input,textarea,[contenteditable]",
      );
      return KeyboardUtils.isTypingTarget(editableAncestor);
    };

    const isMenuControlTargetOrAncestor = (target) => {
      if (!target || typeof target.closest !== "function") return false;
      return Boolean(
        target.closest(
          "select,option,button,[aria-haspopup],[role='button'],[role='listbox'],[role='menu'],[role='option']",
        ),
      );
    };

    const refocusCanvas = () => {
      const active = document.activeElement;
      if (active === canvasElement) return;
      if (KeyboardUtils.isTypingTarget(active)) return;
      KeyboardUtils._safeFocus(canvasElement);
    };

    const onPointerUp = (event) => {
      const target = event?.target;
      if (isCanvasTarget(target)) {
        requestAnimationFrame(refocusCanvas);
        return;
      }
      if (isTypingTargetOrAncestor(target)) return;
      if (isMenuControlTargetOrAncestor(target)) return;
      requestAnimationFrame(refocusCanvas);
    };

    document.addEventListener("pointerup", onPointerUp, true);

    const cleanup = () => {
      document.removeEventListener("pointerup", onPointerUp, true);
      KeyboardUtils._canvasFocusBridges.delete(canvasElement);
    };

    KeyboardUtils._canvasFocusBridges.set(canvasElement, cleanup);
    return cleanup;
  }

  static safeHandle(label, action, handler) {
    const tag = label || "Keyboard";
    const diagnosticsLogger = {
      info: (...args) => console.info(`[${tag}]`, ...args),
      warn: (...args) => console.warn(`[${tag}]`, ...args),
      error: (...args) => console.error(`[${tag}]`, ...args),
      debug: (...args) => console.debug(`[${tag}]`, ...args),
    };

    try {
      return handler();
    } catch (error) {
      diagnosticsLogger.error(`Keyboard ${action} handling failed:`, error);
      return false;
    }
  }

  static isShiftHeld() {
    KeyboardUtils._ensureModifierTracking();
    return (
      KeyboardUtils._modifierState.shift || KeyboardUtils.isKeyDown("SHIFT", 16)
    );
  }

  static isCtrlHeld() {
    KeyboardUtils._ensureModifierTracking();
    return (
      KeyboardUtils._modifierState.ctrl ||
      KeyboardUtils.isKeyDown("CONTROL", 17)
    );
  }

  static isAltHeld() {
    KeyboardUtils._ensureModifierTracking();
    return (
      KeyboardUtils._modifierState.alt || KeyboardUtils.isKeyDown("ALT", 18)
    );
  }

  static isMetaHeld() {
    KeyboardUtils._ensureModifierTracking();
    return (
      KeyboardUtils._modifierState.meta ||
      KeyboardUtils.isKeyDown("META", 91) ||
      KeyboardUtils.isKeyDown("META", 93)
    );
  }
}

window.KeyboardUtils = KeyboardUtils;
