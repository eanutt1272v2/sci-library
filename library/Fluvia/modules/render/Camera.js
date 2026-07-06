import { Quaternion } from "../math/Quaternion.js";

class Camera {
  /**
   * @param {{params: Object, store: Object, p: Object}} facade - Live param
   *   view, the store (for resolving cameraSmoothing/cameraOrbitSensitivity/
   *   cameraZoomSensitivity's bounds via `getRange` instead of hardcoding
   *   them here), plus the p5 instance (for math helpers and pointer/touch
   *   sketch state).
   */
  constructor(facade) {
    this.params = facade.params;
    this.store = facade.store;
    this.p = facade.p;

    this.target = {
      yaw: 0,
      pitch: 0.8,
      zoom: 750,
    };

    this.current = {
      yaw: 0,
      pitch: 0.8,
      zoom: 750,
    };

    this.quaternion = new Quaternion();

    this.gesture = {
      orbit: null,
      pinch: null,
    };

    this.singlePointer = { x: 0, y: 0 };

    this.defaultSmoothing = 0.82;
    this.maxOrbitStep = 0.25;
  }

  _getMotionAlpha() {
    const p = this.p;
    const { min, max } = this.store.getRange("cameraSmoothing");
    const smoothingRaw = Number(this.params?.cameraSmoothing);
    const smoothing = Number.isFinite(smoothingRaw)
      ? p.constrain(smoothingRaw, min, max)
      : this.defaultSmoothing;

    const baseAlpha = 1 - smoothing;
    const dtMs = Number(p.deltaTime);
    const frameScale = p.constrain(
      (Number.isFinite(dtMs) ? dtMs : 16.6667) / 16.6667,
      0.25,
      4,
    );

    return 1 - Math.pow(1 - baseAlpha, frameScale);
  }

  _getOrbitSensitivity() {
    const raw = Number(this.params?.cameraOrbitSensitivity);
    if (!Number.isFinite(raw)) return 0.007;
    const { min, max } = this.store.getRange("cameraOrbitSensitivity");
    return this.p.constrain(raw, min, max);
  }

  _getZoomSensitivity() {
    const raw = Number(this.params?.cameraZoomSensitivity);
    if (!Number.isFinite(raw)) return 0.5;
    const { min, max } = this.store.getRange("cameraZoomSensitivity");
    return this.p.constrain(raw, min, max);
  }

  update() {
    const { current, target } = this;
    const p = this.p;
    const alpha = this._getMotionAlpha();

    current.yaw = p.lerp(current.yaw, target.yaw, alpha);
    current.pitch = p.lerp(current.pitch, target.pitch, alpha);
    current.zoom = p.lerp(current.zoom, target.zoom, alpha);

    this.quaternion = Quaternion.fromEuler(
      current.pitch,
      current.yaw,
    ).normalise();
  }

  getEyePosition() {
    const { zoom } = this.current;
    return this.quaternion.applyToVector({ x: 0, y: zoom, z: 0 });
  }

  getUpVector() {
    return this.quaternion.applyToVector({ x: 0, y: 0, z: -1 });
  }

  getViewDirection() {
    return this.quaternion.applyToVector({ x: 0, y: 1, z: 0 });
  }

  handleWheel(event) {
    const rawDelta =
      Number(event?.delta) ||
      Number(event?.deltaY) ||
      Number(event?.wheelDelta) ||
      0;
    this.target.zoom = this.p.max(
      20,
      this.target.zoom + rawDelta * this._getZoomSensitivity(),
    );
  }

  beginPointer(event) {
    const p = this.p;
    const touchCount = p.touches.length;
    const { gesture } = this;

    if (touchCount === 1) {
      gesture.orbit = { x: p.touches[0].x, y: p.touches[0].y };
      gesture.pinch = null;
      return;
    }

    if (touchCount === 2) {
      gesture.pinch = {
        distance: p.max(
          1,
          p.dist(
            p.touches[0].x,
            p.touches[0].y,
            p.touches[1].x,
            p.touches[1].y,
          ),
        ),
      };
      gesture.orbit = null;
      return;
    }

    const x = Number(event?.offsetX);
    const y = Number(event?.offsetY);
    gesture.orbit = {
      x: Number.isFinite(x) ? x : p.mouseX,
      y: Number.isFinite(y) ? y : p.mouseY,
    };
    gesture.pinch = null;
  }

  endPointer() {
    this.gesture.orbit = null;
    this.gesture.pinch = null;
  }

  handlePointer(event) {
    const p = this.p;
    const touchCount = p.touches.length;

    if (touchCount === 1) {
      this.handleOrbit(p.touches[0]);
      return;
    }

    if (touchCount === 2) {
      this.handlePinch(p.touches[0], p.touches[1]);
      return;
    }

    if (touchCount === 0 && p.mouseIsPressed) {
      const movementX = Number(event?.movementX);
      const movementY = Number(event?.movementY);
      if (Number.isFinite(movementX) && Number.isFinite(movementY)) {
        this.applyOrbitDelta(movementX, movementY);
        return;
      }

      this.singlePointer.x = p.mouseX;
      this.singlePointer.y = p.mouseY;
      this.handleOrbit(this.singlePointer);
      return;
    }

    this.endPointer();
  }

  applyOrbitDelta(deltaX, deltaY) {
    const p = this.p;
    const sensitivity = this._getOrbitSensitivity();
    const dx = p.constrain(
      deltaX * sensitivity,
      -this.maxOrbitStep,
      this.maxOrbitStep,
    );
    const dy = p.constrain(
      deltaY * sensitivity,
      -this.maxOrbitStep,
      this.maxOrbitStep,
    );

    this.target.yaw += dx;
    this.target.pitch = p.constrain(this.target.pitch + dy, -1.56, 1.56);
  }

  handleOrbit(touch) {
    const { gesture } = this;

    if (!gesture.orbit) {
      gesture.orbit = { x: touch.x, y: touch.y };
      gesture.pinch = null;
      return;
    }

    const dx = touch.x - gesture.orbit.x;
    const dy = touch.y - gesture.orbit.y;
    this.applyOrbitDelta(dx, dy);

    gesture.orbit.x = touch.x;
    gesture.orbit.y = touch.y;
  }

  handlePinch(t1, t2) {
    const p = this.p;
    const { gesture, target } = this;
    const distance = p.dist(t1.x, t1.y, t2.x, t2.y);

    if (!gesture.pinch) {
      gesture.pinch = { distance };
      gesture.orbit = null;
      return;
    }

    const ratio = p.constrain(
      distance / p.max(1, gesture.pinch.distance),
      0.5,
      2,
    );
    const zoomFactor = Math.pow(ratio, this._getZoomSensitivity());
    target.zoom = p.max(20, target.zoom / zoomFactor);

    gesture.pinch.distance = p.max(1, distance);
  }
}

export { Camera };
