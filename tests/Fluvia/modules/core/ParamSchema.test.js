import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { FLUVIA_SCHEMA } from "../../../../library/Fluvia/modules/core/ParamSchema.js";
import { ParamStore } from "../../../../library/_shared/utils/ParamStore.js";

/**
 * The schema is the single source of truth consumed by ParamStore, the GUI, the
 * InputHandler and (defensively) the worker. These tests lock in its shape and
 * the reconciled ranges so a future edit that re-introduces range drift fails
 * loudly.
 */
describe("FLUVIA_SCHEMA shape", () => {
  test("every entry has a valid type and a default", () => {
    const validTypes = new Set(["int", "float", "bool", "enum", "color"]);
    for (const [key, entry] of Object.entries(FLUVIA_SCHEMA)) {
      assert.ok(entry && typeof entry === "object", `${key} is an object`);
      assert.ok(validTypes.has(entry.type), `${key} has a valid type`);
      assert.ok("default" in entry, `${key} declares a default`);
    }
  });

  test("numeric entries have min <= default <= max", () => {
    for (const [key, entry] of Object.entries(FLUVIA_SCHEMA)) {
      if (entry.type !== "int" && entry.type !== "float") continue;
      if (typeof entry.min === "number") {
        assert.ok(entry.default >= entry.min, `${key} default >= min`);
      }
      if (typeof entry.max === "number") {
        assert.ok(entry.default <= entry.max, `${key} default <= max`);
      }
    }
  });

  test("covers the full hydraulic/render/camera/recording parameter set", () => {
    const expected = [
      "running",
      "dropletsPerFrame",
      "maxAge",
      "minVolume",
      "terrainSize",
      "noiseScale",
      "noiseOctaves",
      "amplitudeFalloff",
      "sedimentErosionRate",
      "bedrockErosionRate",
      "depositionRate",
      "evaporationRate",
      "precipitationRate",
      "entrainment",
      "gravity",
      "momentumTransfer",
      "learningRate",
      "maxHeightDiff",
      "settlingRate",
      "renderStatistics",
      "renderLegend",
      "renderKeymapRef",
      "renderMethod",
      "heightScale",
      "surfaceMap",
      "colourMap",
      "cameraSmoothing",
      "cameraOrbitSensitivity",
      "cameraZoomSensitivity",
      "lightDir.x",
      "lightDir.y",
      "lightDir.z",
      "specularIntensity",
      "skyColour",
      "steepColour",
      "flatColour",
      "sedimentColour",
      "waterColour",
      "imageFormat",
      "recordingFPS",
      "videoBitrateMbps",
    ];
    for (const key of expected) {
      assert.ok(key in FLUVIA_SCHEMA, `schema declares ${key}`);
    }
  });
});

describe("FLUVIA_SCHEMA reconciled ranges", () => {
  test("widened params expose the broad InputHandler+AppCore range, not the stale GUI slider", () => {
    assert.deepEqual(
      { min: FLUVIA_SCHEMA.maxAge.min, max: FLUVIA_SCHEMA.maxAge.max },
      { min: 8, max: 2048 },
    );
    assert.deepEqual(
      { min: FLUVIA_SCHEMA.minVolume.min, max: FLUVIA_SCHEMA.minVolume.max },
      { min: 1e-5, max: 1 },
    );
    assert.deepEqual(
      { min: FLUVIA_SCHEMA.noiseScale.min, max: FLUVIA_SCHEMA.noiseScale.max },
      { min: 0.01, max: 10 },
    );
  });

  test("dropletsPerFrame and heightScale adopt the GUI/InputHandler agreement", () => {
    assert.equal(FLUVIA_SCHEMA.dropletsPerFrame.max, 512);
    assert.equal(FLUVIA_SCHEMA.heightScale.max, 256);
  });

  test("specularIntensity is brought to the InputHandler+AppCore 0-4096 agreement", () => {
    assert.deepEqual(
      {
        min: FLUVIA_SCHEMA.specularIntensity.min,
        max: FLUVIA_SCHEMA.specularIntensity.max,
      },
      { min: 0, max: 4096 },
    );
  });
});

describe("FLUVIA_SCHEMA drives a working ParamStore", () => {
  test("ParamStore constructs and seeds every default", () => {
    const store = new ParamStore(FLUVIA_SCHEMA);
    assert.equal(store.get("running"), true);
    assert.equal(store.get("terrainSize"), 256);
    assert.deepEqual(store.get("skyColour"), { r: 173, g: 183, b: 196 });
    assert.equal(store.get("lightDir.z"), -50);
  });

  test("int params round and clamp; enum reverts unknown to default", () => {
    const store = new ParamStore(FLUVIA_SCHEMA);
    assert.equal(store.set("dropletsPerFrame", 99999), 512);
    assert.equal(store.set("dropletsPerFrame", 4.6), 5);
    assert.equal(store.set("surfaceMap", "nope"), "composite");
  });

  test("colourMap enum honours runtime dynamicOptions", () => {
    const store = new ParamStore(FLUVIA_SCHEMA, {
      dynamicOptions: { colourMap: ["viridis", "magma"] },
    });
    assert.equal(store.set("colourMap", "magma"), "magma");
    assert.equal(store.set("colourMap", "not-loaded"), "viridis");
  });

  test("lightDir dotted keys are exposed as a live nested view via asObject", () => {
    const store = new ParamStore(FLUVIA_SCHEMA);
    const view = store.asObject("lightDir", ["x", "y", "z"]);
    view.x = 25;
    assert.equal(store.get("lightDir.x"), 25);
    assert.equal(view.y, 50);
  });
});
