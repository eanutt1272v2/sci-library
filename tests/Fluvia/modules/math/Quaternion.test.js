import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Quaternion } from "../../../../library/Fluvia/modules/math/Quaternion.js";

function approxVectorEqual(a, b, epsilon = 1e-9) {
  assert.ok(Math.abs(a.x - b.x) < epsilon, `x: ${a.x} !~ ${b.x}`);
  assert.ok(Math.abs(a.y - b.y) < epsilon, `y: ${a.y} !~ ${b.y}`);
  assert.ok(Math.abs(a.z - b.z) < epsilon, `z: ${a.z} !~ ${b.z}`);
}

describe("Quaternion", () => {
  test("default constructor is the identity quaternion", () => {
    const q = new Quaternion();
    assert.deepEqual({ x: q.x, y: q.y, z: q.z, w: q.w }, { x: 0, y: 0, z: 0, w: 1 });
  });

  test("fromAxisAngle(axis, 0) is the identity regardless of axis", () => {
    const q = Quaternion.fromAxisAngle({ x: 0.3, y: 0.7, z: 0.1 }, 0);
    assert.ok(Math.abs(q.x) < 1e-12 && Math.abs(q.y) < 1e-12 && Math.abs(q.z) < 1e-12);
    assert.ok(Math.abs(q.w - 1) < 1e-12);
  });

  test("a full 2*PI rotation is the double-cover of identity (-q) but rotates vectors identically", () => {
    const q2pi = Quaternion.fromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI * 2);
    assert.ok(Math.abs(q2pi.w + 1) < 1e-9, "w should be ~ -1, not +1");
    const v = { x: 1, y: 0, z: 0 };
    approxVectorEqual(q2pi.applyToVector(v), v);
  });

  test("multiply: identity is a two-sided identity element", () => {
    const identity = new Quaternion();
    const q = Quaternion.fromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    const left = identity.multiply(q);
    const right = q.multiply(identity);
    for (const k of ["x", "y", "z", "w"]) {
      assert.ok(Math.abs(left[k] - q[k]) < 1e-9);
      assert.ok(Math.abs(right[k] - q[k]) < 1e-9);
    }
  });

  test("applyToVector: identity leaves a vector unchanged", () => {
    const identity = new Quaternion();
    const v = { x: 1, y: 2, z: 3 };
    approxVectorEqual(identity.applyToVector(v), v);
  });

  test("applyToVector: 90 degree rotation about Z maps (1,0,0) to (0,1,0)", () => {
    const qz90 = Quaternion.fromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2);
    approxVectorEqual(qz90.applyToVector({ x: 1, y: 0, z: 0 }), { x: 0, y: 1, z: 0 });
  });

  test("fromEuler composition order matches qYaw.multiply(qPitch), applied pitch-then-yaw", () => {
    const pitch = 0.3;
    const yaw = 0.5;
    const qPitch = Quaternion.fromAxisAngle({ x: 1, y: 0, z: 0 }, pitch);
    const qYaw = Quaternion.fromAxisAngle({ x: 0, y: 0, z: 1 }, yaw);
    const viaEuler = Quaternion.fromEuler(pitch, yaw);

    const v = { x: 1, y: 2, z: 3 };
    const sequential = qYaw.applyToVector(qPitch.applyToVector(v));
    const composed = viaEuler.applyToVector(v);
    approxVectorEqual(sequential, composed, 1e-7);
  });

  test("normalise(): unit-norm invariant after normalising a non-unit quaternion", () => {
    const q = new Quaternion(1, 2, 3, 4).normalise();
    const normSq = q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2;
    assert.ok(Math.abs(normSq - 1) < 1e-12);
  });

  test("normalise() returns the same instance (chainable)", () => {
    const q = new Quaternion(1, 0, 0, 0);
    assert.equal(q.normalise(), q);
  });

  test("normalise() on the zero quaternion is a documented no-op, not NaN (known edge case, tracked for Stage 2)", () => {
    const zero = new Quaternion(0, 0, 0, 0).normalise();
    assert.deepEqual({ x: zero.x, y: zero.y, z: zero.z, w: zero.w }, { x: 0, y: 0, z: 0, w: 0 });
  });
});
