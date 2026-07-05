import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ParamStore } from "../../../../library/_shared/utils/ParamStore.js";
import { PSI_SCHEMA } from "../../../../library/Psi/modules/core/ParamSchema.js";

describe("PSI_SCHEMA coverage", () => {
  test("declares every parameter AppCore routes through the store", () => {
    const required = [
      "n",
      "l",
      "m",
      "nuclearCharge",
      "nucleusMassKg",
      "resolution",
      "logAlpha",
      "colourMap",
      "viewRadius",
      "sliceOffset",
      "viewCentre.x",
      "viewCentre.y",
      "viewCentre.z",
      "recordingFPS",
      "videoBitrateMbps",
    ];
    for (const key of required) {
      assert.ok(key in PSI_SCHEMA, `missing schema key: ${key}`);
    }
  });

  test("constructs a ParamStore and seeds documented defaults", () => {
    const store = new ParamStore(PSI_SCHEMA);
    assert.equal(store.get("n"), 3);
    assert.equal(store.get("l"), 1);
    assert.equal(store.get("m"), 0);
    assert.equal(store.get("logAlpha"), 200);
    assert.equal(store.get("colourMap"), "rocket");
    assert.equal(store.get("slicePlane"), "xz");
    assert.equal(store.get("viewRadius"), 45);
  });
});

describe("PSI_SCHEMA reconciled numeric ranges", () => {
  test("resolution clamps into 64-512 (adopted from GUI/InputHandler/Worker)", () => {
    const store = new ParamStore(PSI_SCHEMA);
    assert.equal(store.set("resolution", 10000), 512);
    assert.equal(store.set("resolution", 1), 64);
  });

  test("n clamps into 1-12", () => {
    const store = new ParamStore(PSI_SCHEMA);
    assert.equal(store.set("n", 999), 12);
    assert.equal(store.set("n", -5), 1);
  });

  test("viewCentre clamps into ±1024 (adopted from InputHandler/AppCore)", () => {
    const store = new ParamStore(PSI_SCHEMA);
    assert.equal(store.set("viewCentre.x", 99999), 1024);
    assert.equal(store.set("viewCentre.y", -99999), -1024);
  });
});

describe("PSI_SCHEMA relative bounds", () => {
  test("l is bounded 0..n-1", () => {
    const store = new ParamStore(PSI_SCHEMA);
    store.set("n", 4);
    assert.deepEqual(store.getRange("l"), { min: 0, max: 3 });
    assert.equal(store.set("l", 9), 3);
  });

  test("m is bounded -l..l", () => {
    const store = new ParamStore(PSI_SCHEMA);
    store.set("n", 5);
    store.set("l", 2);
    assert.deepEqual(store.getRange("m"), { min: -2, max: 2 });
    assert.equal(store.set("m", 9), 2);
    assert.equal(store.set("m", -9), -2);
  });

  test("sliceOffset is bounded ±viewRadius", () => {
    const store = new ParamStore(PSI_SCHEMA);
    store.set("viewRadius", 30);
    assert.deepEqual(store.getRange("sliceOffset"), { min: -30, max: 30 });
    assert.equal(store.set("sliceOffset", 100), 30);
    assert.equal(store.set("sliceOffset", -100), -30);
  });
});

describe("PSI_SCHEMA dynamic colourMap options", () => {
  test("colourMap accepts a runtime option list and rejects unknowns", () => {
    const store = new ParamStore(PSI_SCHEMA, {
      dynamicOptions: { colourMap: ["rocket", "mako", "viridis"] },
    });
    assert.equal(store.set("colourMap", "viridis"), "viridis");
    assert.equal(store.set("colourMap", "not-a-map"), "rocket");
  });
});
