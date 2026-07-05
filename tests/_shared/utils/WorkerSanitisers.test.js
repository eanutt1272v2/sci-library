import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { WorkerSanitisers } from "../../../library/_shared/utils/WorkerSanitisers.js";
const { clamp, toFiniteNumber, toInteger } = WorkerSanitisers;

describe("WorkerSanitisers.clamp", () => {
  test("value below min clamps to min (boundary inclusive)", () => {
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(0, 0, 10), 0);
  });

  test("value above max clamps to max (boundary inclusive)", () => {
    assert.equal(clamp(11, 0, 10), 10);
    assert.equal(clamp(10, 0, 10), 10);
  });

  test("value within range passes through unchanged", () => {
    assert.equal(clamp(5, 0, 10), 5);
  });

  test("NaN passes through unclamped (known quirk: NaN comparisons are always false)", () => {
    assert.ok(Number.isNaN(clamp(NaN, 0, 10)));
  });
});

describe("WorkerSanitisers.toFiniteNumber", () => {
  test("null coerces to 0 via Number(null), not the fallback", () => {
    assert.equal(toFiniteNumber(null, -1), 0);
  });

  test("undefined is not finite (Number(undefined) is NaN) and returns the fallback", () => {
    assert.equal(toFiniteNumber(undefined, -1), -1);
  });

  test("default fallback is 0 when omitted", () => {
    assert.equal(toFiniteNumber(undefined), 0);
  });

  test("finite numeric strings coerce to their numeric value", () => {
    assert.equal(toFiniteNumber("3.5", -1), 3.5);
  });

  test("non-finite values (Infinity, NaN) return the fallback", () => {
    assert.equal(toFiniteNumber(Infinity, -1), -1);
    assert.equal(toFiniteNumber(NaN, -1), -1);
  });
});

describe("WorkerSanitisers.toInteger", () => {
  test("rounds .5 up (toward +Infinity) for positive values", () => {
    assert.equal(toInteger(2.5, 0, 0, 10), 3);
  });

  test("rounds .5 up (toward +Infinity) for negative values, i.e. toward zero not away from it", () => {
    assert.equal(toInteger(-2.5, 0, -10, 10), -2);
  });

  test("uses the fallback when the input is not finite, then clamps it", () => {
    assert.equal(toInteger(undefined, 4, 0, 10), 4);
    assert.equal(toInteger(NaN, 999, 0, 10), 10);
  });

  test("clamps the rounded result into [min, max]", () => {
    assert.equal(toInteger(100, 0, 0, 10), 10);
    assert.equal(toInteger(-100, 0, 0, 10), 0);
  });
});
