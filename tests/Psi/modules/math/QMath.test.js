import { test, describe } from "node:test";
import assert from "node:assert/strict";

import "../../../../library/Psi/modules/math/QMath.js";
const { logGamma, genLaguerre, assocLegendre } = globalThis.QMath;

describe("QMath.logGamma", () => {
  test("logGamma(1) is 0 (ln Gamma(1) = ln 1! = 0)", () => {
    assert.ok(Math.abs(logGamma(1)) < 1e-9);
  });

  test("logGamma(5) matches ln(4!) = ln(24)", () => {
    assert.ok(Math.abs(logGamma(5) - Math.log(24)) < 1e-9);
  });

  test("reflection branch (z < 0.5) matches known value", () => {
    // ln Gamma(0.25) ~= 1.2880225246...
    assert.ok(Math.abs(logGamma(0.25) - 1.288022524698077) < 1e-9);
  });
});

describe("QMath.genLaguerre", () => {
  test("k <= 0 returns 1.0", () => {
    assert.equal(genLaguerre(0, 0, 5), 1.0);
    assert.equal(genLaguerre(-1, 0, 5), 1.0);
  });

  test("k = 1 matches closed form L_1^0(x) = 1 - x", () => {
    assert.equal(genLaguerre(1, 0, 5), -4);
  });

  test("overflow guard returns exactly 0.0, not NaN/Infinity", () => {
    const result = genLaguerre(2000, 0, -1e300);
    assert.equal(result, 0.0);
    assert.ok(Number.isFinite(result));
  });
});

describe("QMath.assocLegendre", () => {
  test("l === absM boundary returns pmm directly", () => {
    // P_1^1(x) = -sqrt(1-x^2) (Condon-Shortley sign convention)
    const x = 0.5;
    const expected = -Math.sqrt(1 - x * x);
    assert.ok(Math.abs(assocLegendre(1, 1, x) - expected) < 1e-9);
  });

  test("l === absM + 1 boundary returns pmmp1 directly", () => {
    // P_1^0(x) = x
    assert.ok(Math.abs(assocLegendre(1, 0, 0.5) - 0.5) < 1e-9);
  });

  test("general recurrence matches closed form P_2^0(x) = (3x^2 - 1) / 2", () => {
    const x = 0.5;
    const expected = (3 * x * x - 1) / 2;
    assert.ok(Math.abs(assocLegendre(2, 0, x) - expected) < 1e-9);
  });

  test("domain edges x = 1 and x = -1 stay finite (no NaN from sqrt of negative slop)", () => {
    assert.ok(Number.isFinite(assocLegendre(3, 1, 1)));
    assert.ok(Number.isFinite(assocLegendre(3, 1, -1)));
    // slightly-over-1 due to floating slop should also not blow up
    assert.ok(Number.isFinite(assocLegendre(3, 1, 1 + 1e-16)));
  });
});
