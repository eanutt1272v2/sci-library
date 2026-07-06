import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Camera } from "../../../../library/Fluvia/modules/render/Camera.js";

/**
 * A minimal p5 stub covering exactly what Camera calls: constrain/lerp/max/
 * dist plus the mouse/touch sketch state it reads.
 */
function makeStubP5(overrides = {}) {
  return {
    constrain(v, min, max) {
      return Math.min(max, Math.max(min, v));
    },
    lerp(a, b, t) {
      return a + (b - a) * t;
    },
    max(...values) {
      return Math.max(...values);
    },
    dist(x1, y1, x2, y2) {
      return Math.hypot(x2 - x1, y2 - y1);
    },
    deltaTime: 16.6667,
    touches: [],
    mouseX: 0,
    mouseY: 0,
    mouseIsPressed: false,
    ...overrides,
  };
}

/**
 * A minimal store stub covering exactly what Camera calls: getRange for the
 * three schema-declared camera-control bounds, matching FLUVIA_SCHEMA.
 */
function makeStubStore() {
  const ranges = {
    cameraSmoothing: { min: 0, max: 0.98 },
    cameraOrbitSensitivity: { min: 0.001, max: 0.03 },
    cameraZoomSensitivity: { min: 0.05, max: 3 },
  };
  return {
    getRange(key) {
      return ranges[key];
    },
  };
}

function makeFacade(paramsOverrides = {}, pOverrides = {}) {
  return {
    params: {
      cameraSmoothing: 0.82,
      cameraOrbitSensitivity: 0.007,
      cameraZoomSensitivity: 0.5,
      ...paramsOverrides,
    },
    store: makeStubStore(),
    p: makeStubP5(pOverrides),
  };
}

describe("Camera construction", () => {
  test("takes params/p from the facade, not an appcore back-reference", () => {
    const camera = new Camera(makeFacade());
    assert.equal(camera.appcore, undefined);
    assert.equal(typeof camera.params, "object");
    assert.equal(typeof camera.p, "object");
    assert.deepEqual(camera.target, { yaw: 0, pitch: 0.8, zoom: 750 });
  });
});

describe("Camera.update", () => {
  test("eases current toward target using the smoothing-derived alpha", () => {
    const camera = new Camera(makeFacade());
    camera.target.yaw = 1;
    camera.update();
    assert.ok(camera.current.yaw > 0 && camera.current.yaw < 1);
  });

  test("getEyePosition/getUpVector/getViewDirection stay finite after update", () => {
    const camera = new Camera(makeFacade());
    camera.target.yaw = 0.4;
    camera.target.pitch = 0.2;
    camera.update();
    for (const v of [
      camera.getEyePosition(),
      camera.getUpVector(),
      camera.getViewDirection(),
    ]) {
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
    }
  });
});

describe("Camera.handleWheel", () => {
  test("zooms out (positive delta) but never below the 20 floor", () => {
    const camera = new Camera(makeFacade());
    camera.target.zoom = 25;
    camera.handleWheel({ deltaY: -1000 });
    assert.equal(camera.target.zoom, 20);
  });

  test("reads delta/deltaY/wheelDelta in that priority order", () => {
    const camera = new Camera(makeFacade());
    camera.target.zoom = 100;
    camera.handleWheel({ delta: 10, deltaY: 999, wheelDelta: 999 });
    assert.equal(
      camera.target.zoom,
      100 + 10 * camera._getZoomSensitivity(),
    );
  });
});

describe("Camera pointer/touch handling", () => {
  test("beginPointer with one touch seeds the orbit gesture", () => {
    const camera = new Camera(
      makeFacade({}, { touches: [{ x: 12, y: 34 }] }),
    );
    camera.beginPointer({});
    assert.deepEqual(camera.gesture.orbit, { x: 12, y: 34 });
    assert.equal(camera.gesture.pinch, null);
  });

  test("beginPointer with two touches seeds the pinch gesture", () => {
    const camera = new Camera(
      makeFacade(
        {},
        {
          touches: [
            { x: 0, y: 0 },
            { x: 3, y: 4 },
          ],
        },
      ),
    );
    camera.beginPointer({});
    assert.equal(camera.gesture.pinch.distance, 5);
    assert.equal(camera.gesture.orbit, null);
  });

  test("applyOrbitDelta clamps pitch into [-1.56, 1.56]", () => {
    const camera = new Camera(makeFacade());
    camera.target.pitch = 1.5;
    camera.applyOrbitDelta(0, 1000);
    assert.ok(camera.target.pitch <= 1.56);
  });

  test("endPointer clears both gestures", () => {
    const camera = new Camera(makeFacade());
    camera.gesture.orbit = { x: 1, y: 1 };
    camera.gesture.pinch = { distance: 5 };
    camera.endPointer();
    assert.equal(camera.gesture.orbit, null);
    assert.equal(camera.gesture.pinch, null);
  });

  test("handlePinch zooms based on the change in touch distance", () => {
    const camera = new Camera(makeFacade());
    camera.target.zoom = 100;
    camera.gesture.pinch = { distance: 10 };
    camera.handlePinch({ x: 0, y: 0 }, { x: 20, y: 0 });
    assert.ok(camera.target.zoom < 100, "pinching apart (2x distance) zooms in (zoom decreases)");
  });
});
