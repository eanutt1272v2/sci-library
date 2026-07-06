import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { FormatUtils } from "../../../library/_shared/utils/FormatUtils.js";

describe("FormatUtils.formatSigned", () => {
  test("zero is the literal +0.000", () => {
    assert.equal(FormatUtils.formatSigned(0), "+0.000");
    assert.equal(FormatUtils.formatSigned(-0), "+0.000");
  });

  test("non-finite input returns 0", () => {
    assert.equal(FormatUtils.formatSigned(NaN), "0");
    assert.equal(FormatUtils.formatSigned(Infinity), "0");
    assert.equal(FormatUtils.formatSigned(-Infinity), "0");
  });

  test("just below the 1e3 exponential threshold uses fixed precision", () => {
    assert.equal(FormatUtils.formatSigned(999), "+999");
  });

  test("at/above the 1e3 threshold switches to exponential notation", () => {
    assert.equal(FormatUtils.formatSigned(1000), "+1.00e^3");
  });

  test("negative values above the 1e3 threshold keep their own sign, no extra +", () => {
    assert.equal(FormatUtils.formatSigned(-1000), "-1.00e^3");
  });

  test("at the 1e-3 lower threshold (not strictly below it) still uses fixed precision", () => {
    assert.equal(FormatUtils.formatSigned(0.001), "+0.00100");
  });

  test("below the 1e-3 threshold switches to exponential notation", () => {
    assert.equal(FormatUtils.formatSigned(0.0009), "+9.00e^-4");
  });

  test("positive mid-range values are prefixed with +", () => {
    assert.equal(FormatUtils.formatSigned(5), "+5.00");
  });
});

describe("FormatUtils.formatPercent", () => {
  test("non-finite input returns 0", () => {
    assert.equal(FormatUtils.formatPercent(NaN), "0");
    assert.equal(FormatUtils.formatPercent(Infinity), "0");
  });

  test("delegates to formatSigned on the value scaled by 100", () => {
    assert.equal(FormatUtils.formatPercent(0.05), "+5.00");
  });
});

describe("FormatUtils.formatInt", () => {
  test("zero formats as 0", () => {
    assert.equal(FormatUtils.formatInt(0), "0");
  });

  test("non-finite input returns 0", () => {
    assert.equal(FormatUtils.formatInt(NaN), "0");
    assert.equal(FormatUtils.formatInt(Infinity), "0");
  });

  test("rounds to the nearest integer", () => {
    assert.equal(FormatUtils.formatInt(2.5), "3");
    assert.equal(FormatUtils.formatInt(2.4), "2");
  });
});

describe("FormatUtils.formatFixed", () => {
  test("zero formats with the requested decimal digits", () => {
    assert.equal(FormatUtils.formatFixed(0), "0.000");
  });

  test("below the 10^-digits threshold switches to exponential notation", () => {
    assert.equal(FormatUtils.formatFixed(0.0001), "1.00e^-4");
  });

  // Fixed: formatFixed used to coerce via `Number(value) || 0`, which let Infinity
  // (truthy) slip past the fallback and reach `.toFixed()`, producing the literal
  // string "Infinity" instead of "0.000" — inconsistent with its three siblings,
  // which all guard on `Number.isFinite`. Now uses the same guard, matching its
  // own decimal-formatted style ("0.000") rather than the siblings' bare "0".
  test("NaN falls back to 0.000", () => {
    assert.equal(FormatUtils.formatFixed(NaN), "0.000");
  });

  test("Infinity and -Infinity fall back to 0.000 instead of the literal string Infinity", () => {
    assert.equal(FormatUtils.formatFixed(Infinity), "0.000");
    assert.equal(FormatUtils.formatFixed(-Infinity), "0.000");
  });
});
