import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { ParamStore } from "../../../library/_shared/utils/ParamStore.js";

/**
 * A representative schema exercising every type and both relative-bound forms:
 * the quantum numbers n/l/m and a slice offset bounded by a view radius.
 */
function makeSchema() {
  return {
    n: { default: 3, type: "int", min: 1, max: 8 },
    l: { default: 0, type: "int", min: 0, max: { key: "n", offset: -1 } },
    m: {
      default: 0,
      type: "int",
      min: { key: "l", sign: -1 },
      max: { key: "l", sign: 1 },
    },
    viewRadius: { default: 10, type: "int", min: 1, max: 100 },
    sliceOffset: {
      default: 0,
      type: "int",
      min: { key: "viewRadius", sign: -1 },
      max: { key: "viewRadius", sign: 1 },
    },
    opacity: { default: 0.5, type: "float", min: 0, max: 1 },
    showAxes: { default: true, type: "bool" },
    colourMap: { default: "rocket", type: "enum", options: ["rocket", "mako"] },
    tint: { default: { r: 0, g: 0, b: 0 }, type: "color" },
  };
}

describe("ParamStore constructor / default seeding", () => {
  test("seeds every key from its schema default", () => {
    const store = new ParamStore(makeSchema());
    assert.equal(store.get("n"), 3);
    assert.equal(store.get("opacity"), 0.5);
    assert.equal(store.get("showAxes"), true);
    assert.equal(store.get("colourMap"), "rocket");
    assert.deepEqual(store.get("tint"), { r: 0, g: 0, b: 0 });
  });

  test("throws TypeError when constructed without a schema object", () => {
    assert.throws(() => new ParamStore(null), TypeError);
  });
});

describe("ParamStore.get", () => {
  test("throws RangeError for an unknown key rather than a soft fallback", () => {
    const store = new ParamStore(makeSchema());
    assert.throws(() => store.get("nope"), RangeError);
  });
});

describe("ParamStore.set coercion and clamping", () => {
  test("int rounds then clamps into [min, max]", () => {
    const store = new ParamStore(makeSchema());
    assert.equal(store.set("n", 4.6), 5);
    assert.equal(store.set("n", 100), 8);
    assert.equal(store.set("n", -100), 1);
  });

  test("float clamps but does not round", () => {
    const store = new ParamStore(makeSchema());
    assert.equal(store.set("opacity", 0.37), 0.37);
    assert.equal(store.set("opacity", 5), 1);
    assert.equal(store.set("opacity", -5), 0);
  });

  test("bool coerces via Boolean()", () => {
    const store = new ParamStore(makeSchema());
    assert.equal(store.set("showAxes", 0), false);
    assert.equal(store.set("showAxes", "yes"), true);
    assert.equal(store.set("showAxes", ""), false);
  });

  test("enum accepts a valid option and reverts to the default otherwise", () => {
    const store = new ParamStore(makeSchema());
    assert.equal(store.set("colourMap", "mako"), "mako");
    assert.equal(store.set("colourMap", "bogus"), "rocket");
  });

  test("color clamps and rounds each channel into 0-255", () => {
    const store = new ParamStore(makeSchema());
    assert.deepEqual(store.set("tint", { r: 300, g: -5, b: 128.7 }), {
      r: 255,
      g: 0,
      b: 129,
    });
  });

  test("color reverts to the default for a non-object input", () => {
    const store = new ParamStore(makeSchema());
    assert.deepEqual(store.set("tint", "nope"), { r: 0, g: 0, b: 0 });
  });

  test("throws RangeError for an unknown key", () => {
    const store = new ParamStore(makeSchema());
    assert.throws(() => store.set("nope", 1), RangeError);
  });
});

describe("ParamStore relative bounds — l bounded by n - 1", () => {
  test("getRange resolves l's max to n - 1 against current state", () => {
    const store = new ParamStore(makeSchema());
    store.set("n", 5);
    assert.deepEqual(store.getRange("l"), { min: 0, max: 4 });
  });

  test("set clamps l against the resolved n - 1 ceiling", () => {
    const store = new ParamStore(makeSchema());
    store.set("n", 3);
    assert.equal(store.set("l", 9), 2); // clamped to n - 1 = 2
  });

  test("changing n changes what l clamps to on a later set", () => {
    const store = new ParamStore(makeSchema());
    store.set("n", 3);
    assert.equal(store.set("l", 9), 2);
    store.set("n", 8);
    assert.equal(store.set("l", 9), 7); // ceiling moved to n - 1 = 7
  });
});

describe("ParamStore relative bounds — m bounded by -l..l", () => {
  test("getRange resolves m's range to [-l, l]", () => {
    const store = new ParamStore(makeSchema());
    store.set("n", 5);
    store.set("l", 3);
    assert.deepEqual(store.getRange("m"), { min: -3, max: 3 });
  });

  test("set clamps m symmetrically against ±l", () => {
    const store = new ParamStore(makeSchema());
    store.set("n", 5);
    store.set("l", 2);
    assert.equal(store.set("m", 9), 2);
    assert.equal(store.set("m", -9), -2);
  });

  test("shrinking l re-clamps m's range on a later set", () => {
    const store = new ParamStore(makeSchema());
    store.set("n", 5);
    store.set("l", 4);
    assert.equal(store.set("m", 4), 4);
    store.set("l", 1);
    assert.equal(store.set("m", 4), 1); // range collapsed to [-1, 1]
  });
});

describe("ParamStore relative bounds — sliceOffset bounded by ±viewRadius", () => {
  test("getRange resolves sliceOffset to [-viewRadius, viewRadius]", () => {
    const store = new ParamStore(makeSchema());
    store.set("viewRadius", 20);
    assert.deepEqual(store.getRange("sliceOffset"), { min: -20, max: 20 });
  });

  test("changing viewRadius changes sliceOffset's clamp on a later set", () => {
    const store = new ParamStore(makeSchema());
    store.set("viewRadius", 20);
    assert.equal(store.set("sliceOffset", 50), 20);
    store.set("viewRadius", 5);
    assert.equal(store.set("sliceOffset", 50), 5);
  });
});

describe("ParamStore dynamicOptions", () => {
  test("a runtime option list overrides the schema's static options", () => {
    const store = new ParamStore(makeSchema(), {
      dynamicOptions: { colourMap: ["viridis", "inferno"] },
    });
    // A value valid only under the dynamic list is accepted...
    assert.equal(store.set("colourMap", "viridis"), "viridis");
    // ...and a value from the now-overridden static list is rejected.
    assert.equal(store.set("colourMap", "mako"), "rocket");
  });
});

describe("ParamStore.snapshot", () => {
  test("returns a frozen copy that is independent of later stores", () => {
    const store = new ParamStore(makeSchema());
    const snap = store.snapshot();
    assert.ok(Object.isFrozen(snap));
    assert.equal(snap.n, 3);
    store.set("n", 7);
    assert.equal(snap.n, 3); // snapshot unaffected by later mutation
    assert.equal(store.get("n"), 7);
  });
});

describe("ParamStore.asObject", () => {
  const nestedSchema = {
    "viewCentre.x": { default: 1, type: "float" },
    "viewCentre.y": { default: 2, type: "float" },
    "viewCentre.z": { default: 3, type: "float" },
  };

  test("reads pass through to the flattened dotted keys", () => {
    const store = new ParamStore(nestedSchema);
    const view = store.asObject("viewCentre", ["x", "y", "z"]);
    assert.equal(view.x, 1);
    assert.equal(view.y, 2);
    assert.equal(view.z, 3);
  });

  test("writes pass through to store.set on the dotted key", () => {
    const store = new ParamStore(nestedSchema);
    const view = store.asObject("viewCentre", ["x", "y", "z"]);
    view.x = 42;
    assert.equal(store.get("viewCentre.x"), 42);
    // And the view reflects a write made directly on the store.
    store.set("viewCentre.y", 99);
    assert.equal(view.y, 99);
  });
});
