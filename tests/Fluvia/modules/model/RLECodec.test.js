import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { RLECodec } from "../../../../library/Fluvia/modules/model/RLECodec.js";

describe("RLECodec.encodeByteArray", () => {
  test("empty or null input encodes to the empty-line marker", () => {
    assert.equal(RLECodec.encodeByteArray([]), "!");
    assert.equal(RLECodec.encodeByteArray(null), "!");
  });

  test("a single value has no count prefix", () => {
    assert.equal(RLECodec.encodeByteArray([5]), "E!");
  });

  test("a long run gets a numeric count prefix", () => {
    const longRun = new Array(300).fill(5);
    assert.equal(RLECodec.encodeByteArray(longRun), "300E!");
  });

  test("out-of-range/garbage values clamp into [0, 255] before encoding", () => {
    assert.equal(RLECodec.encodeByteArray([-5]), ".!"); // clamps to 0
    assert.equal(RLECodec.encodeByteArray([999]), "o!"); // clamps to 255
    assert.equal(RLECodec.encodeByteArray(["foo"]), ".!"); // Number("foo")|0 -> 0
    assert.equal(RLECodec.encodeByteArray([NaN]), ".!"); // NaN|0 -> 0
  });
});

describe("RLECodec.decodeByteArray", () => {
  test("length <= 0 or falsy string returns an empty/zeroed buffer without throwing", () => {
    assert.equal(RLECodec.decodeByteArray("5A!", 0).length, 0);
    assert.deepEqual(Array.from(RLECodec.decodeByteArray("", 10)), new Array(10).fill(0));
  });

  test("regression: pure garbage input never throws or hangs, and stays within bounds", () => {
    const result = RLECodec.decodeByteArray("@@@@####", 10);
    assert.equal(result.length, 10);
  });

  test("regression: an absurd run-count never overruns the output buffer", () => {
    const result = RLECodec.decodeByteArray("999999999o!", 10);
    assert.equal(result.length, 10);
    assert.deepEqual(Array.from(result), new Array(10).fill(255));
  });

  test("comment/header lines ('#', 'x = ...') are stripped and don't affect decoding", () => {
    const rle = "#comment\nx = 3, y = 1\n3A!";
    const result = RLECodec.decodeByteArray(rle, 3);
    assert.deepEqual(Array.from(result), [1, 1, 1]);
  });
});

test("exhaustive byte<->token round trip across the full 0-255 range", () => {
  for (let b = 0; b <= 255; b++) {
    const token = RLECodec._byteToToken(b);
    const back = RLECodec._tokenToByte(token);
    assert.equal(back, b, `byte ${b} -> token "${token}" -> ${back}`);
  }
});

test("encodeByteArray -> decodeByteArray round trip", () => {
  const arr = [0, 1, 2, 24, 25, 26, 254, 255, 100, 100, 100];
  const encoded = RLECodec.encodeByteArray(arr);
  const decoded = RLECodec.decodeByteArray(encoded, arr.length);
  assert.deepEqual(Array.from(decoded), arr);
});

test("encodeFloat32Array -> decodeFloat32Array round trip is bit-exact", () => {
  const floats = new Float32Array([-1.5, 0, 3.25, 1e10, -1e-10]);
  const encoded = RLECodec.encodeFloat32Array(floats);
  const decoded = RLECodec.decodeFloat32Array(encoded, floats.length);
  assert.deepEqual(Array.from(decoded), Array.from(floats));
});
