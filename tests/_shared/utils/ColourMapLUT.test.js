import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ColourMapLUT } from "../../../library/_shared/utils/ColourMapLUT.js";

// ColourMapLUT.buildLUT/sampleColour take a `p` (p5 instance) explicitly for
// `constrain` now, rather than reading it as a bare global — a fake p is all
// these tests need, no real p5 required.
const fakeP = {
  constrain: (n, low, high) => Math.min(Math.max(n, low), high),
};

describe("ColourMapLUT.buildLUT", () => {
  test("GREYSCALE is linear: lut value at index i equals i, at the low/mid/high boundaries", () => {
    const lut = new Uint8Array(256 * 3);
    ColourMapLUT.buildLUT(fakeP, ColourMapLUT.GREYSCALE, lut, null, false);

    for (const i of [0, 128, 255]) {
      const idx = i * 3;
      assert.equal(lut[idx], i);
      assert.equal(lut[idx + 1], i);
      assert.equal(lut[idx + 2], i);
    }
  });

  test("a falsy colourMapData is a no-op (lut left untouched)", () => {
    const lut = new Uint8Array(256 * 3).fill(7);
    ColourMapLUT.buildLUT(fakeP, null, lut, null, false);
    assert.ok(lut.every((v) => v === 7));
  });

  test("packed LUT assembles r|g<<8|b<<16|(255<<24) per entry when little-endian", () => {
    const lut = new Uint8Array(256 * 3);
    const lutPacked = new Uint32Array(256);
    ColourMapLUT.buildLUT(fakeP, ColourMapLUT.GREYSCALE, lut, lutPacked, true);

    for (const i of [0, 128, 255]) {
      const expected = (i | (i << 8) | (i << 16) | (255 << 24)) >>> 0;
      assert.equal(lutPacked[i], expected);
    }
  });

  test("packed LUT is left untouched when isLittleEndian is false", () => {
    const lut = new Uint8Array(256 * 3);
    const lutPacked = new Uint32Array(256).fill(0xdeadbeef >>> 0);
    ColourMapLUT.buildLUT(fakeP, ColourMapLUT.GREYSCALE, lut, lutPacked, false);
    assert.ok(lutPacked.every((v) => v === (0xdeadbeef >>> 0)));
  });
});

describe("ColourMapLUT.sampleColour", () => {
  test("a falsy colourMapData returns opaque white", () => {
    assert.deepEqual(ColourMapLUT.sampleColour(fakeP, null, 0.5), [255, 255, 255]);
  });

  test("GREYSCALE sampleColour matches buildLUT at t = 0, 0.5, 1", () => {
    assert.deepEqual(ColourMapLUT.sampleColour(fakeP, ColourMapLUT.GREYSCALE, 0), [0, 0, 0]);
    assert.deepEqual(ColourMapLUT.sampleColour(fakeP, ColourMapLUT.GREYSCALE, 0.5), [128, 128, 128]);
    assert.deepEqual(ColourMapLUT.sampleColour(fakeP, ColourMapLUT.GREYSCALE, 1), [255, 255, 255]);
  });

  test("t outside [0, 1] is clamped before sampling", () => {
    assert.deepEqual(ColourMapLUT.sampleColour(fakeP, ColourMapLUT.GREYSCALE, -5), [0, 0, 0]);
    assert.deepEqual(ColourMapLUT.sampleColour(fakeP, ColourMapLUT.GREYSCALE, 5), [255, 255, 255]);
  });
});

describe("ColourMapLUT.valueToColour", () => {
  test("reads back the three channels at the index nearest val * 255", () => {
    const lut = new Uint8Array(256 * 3);
    ColourMapLUT.buildLUT(fakeP, ColourMapLUT.GREYSCALE, lut, null, false);

    assert.deepEqual(ColourMapLUT.valueToColour(lut, 0), [0, 0, 0]);
    assert.deepEqual(ColourMapLUT.valueToColour(lut, 0.5), [128, 128, 128]);
    assert.deepEqual(ColourMapLUT.valueToColour(lut, 1), [255, 255, 255]);
  });

  test("val outside [0, 1] clamps to the first/last LUT entry", () => {
    const lut = new Uint8Array(256 * 3);
    ColourMapLUT.buildLUT(fakeP, ColourMapLUT.GREYSCALE, lut, null, false);

    assert.deepEqual(ColourMapLUT.valueToColour(lut, -1), [0, 0, 0]);
    assert.deepEqual(ColourMapLUT.valueToColour(lut, 2), [255, 255, 255]);
  });
});
