import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Terrain } from "../../../../library/Fluvia/modules/model/Terrain.js";

/**
 * A minimal p5 stub covering exactly what Terrain.generate() calls: the noise
 * helpers plus constrain/random. Deterministic so tests can assert on shape
 * rather than exact noise values.
 */
function makeStubP5() {
  return {
    noiseDetail() {},
    constrain(v, min, max) {
      return Math.min(max, Math.max(min, v));
    },
    random() {
      return 0;
    },
    noise(x, y) {
      // Deterministic, bounded [0,1)-ish stand-in for p5's noise().
      return Math.abs(Math.sin(x * 12.9898 + y * 78.233)) % 1;
    },
  };
}

function makeFacade(overrides = {}) {
  return {
    params: {
      terrainSize: 4,
      noiseScale: 0.6,
      noiseOctaves: 8,
      amplitudeFalloff: 0.6,
      heightScale: 100,
      ...overrides,
    },
    p: makeStubP5(),
  };
}

describe("Terrain construction", () => {
  test("sizes every buffer to terrainSize^2 and takes params/p from the facade, not an appcore back-reference", () => {
    const terrain = new Terrain(makeFacade({ terrainSize: 4 }));
    assert.equal(terrain.size, 4);
    assert.equal(terrain.area, 16);
    assert.equal(terrain.heightMap.length, 16);
    assert.equal(terrain.appcore, undefined);
    assert.equal(typeof terrain.params, "object");
    assert.equal(typeof terrain.p, "object");
  });

  test("floatMapKeys exposes every Float32Array buffer as a public getter", () => {
    const terrain = new Terrain(makeFacade());
    const keys = terrain.floatMapKeys;
    for (const key of [
      "heightMap",
      "bedrockMap",
      "sedimentMap",
      "dischargeMap",
      "dischargeTrack",
      "momentumX",
      "momentumY",
      "momentumXTrack",
      "momentumYTrack",
      "originalHeightMap",
    ]) {
      assert.ok(keys.includes(key), `floatMapKeys includes ${key}`);
    }
  });
});

describe("Terrain.getIndex / getHeight", () => {
  test("getIndex is row-major", () => {
    const terrain = new Terrain(makeFacade({ terrainSize: 4 }));
    assert.equal(terrain.getIndex(2, 1), 1 * 4 + 2);
  });

  test("getHeight returns 0 out of bounds and the stored value in bounds", () => {
    const terrain = new Terrain(makeFacade({ terrainSize: 4 }));
    terrain.heightMap[terrain.getIndex(1, 1)] = 0.75;
    assert.equal(terrain.getHeight(1, 1), 0.75);
    assert.equal(terrain.getHeight(-1, 0), 0);
    assert.equal(terrain.getHeight(4, 0), 0);
  });
});

describe("Terrain.getMapBounds", () => {
  test("returns {min:0,max:0} for an empty array", () => {
    const terrain = new Terrain(makeFacade());
    assert.deepEqual(terrain.getMapBounds(new Float32Array(0)), {
      min: 0,
      max: 0,
    });
  });

  test("finds min/max across the array", () => {
    const terrain = new Terrain(makeFacade());
    const arr = new Float32Array([0.2, -0.5, 3, 1]);
    assert.deepEqual(terrain.getMapBounds(arr), { min: -0.5, max: 3 });
  });
});

describe("Terrain.codyErf / getDischarge", () => {
  test("codyErf(0) is 0 and is an odd function", () => {
    const terrain = new Terrain(makeFacade());
    assert.equal(terrain.codyErf(0), 0);
    assert.ok(Math.abs(terrain.codyErf(1) + terrain.codyErf(-1)) < 1e-9);
  });

  test("codyErf saturates to +-1 for large |x|", () => {
    const terrain = new Terrain(makeFacade());
    assert.equal(terrain.codyErf(10), 1);
    assert.equal(terrain.codyErf(-10), -1);
  });

  test("getDischarge is 0 out of bounds", () => {
    const terrain = new Terrain(makeFacade());
    assert.equal(terrain.getDischarge(-1), 0);
    assert.equal(terrain.getDischarge(terrain.area + 10), 0);
  });
});

describe("Terrain.generate / reset", () => {
  test("generate normalises heightMap into [0,1] and mirrors into bedrock/original", () => {
    const terrain = new Terrain(makeFacade({ terrainSize: 4 }));
    terrain.generate();

    let min = Infinity;
    let max = -Infinity;
    for (const v of terrain.heightMap) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    assert.ok(min >= 0 && max <= 1);
    assert.deepEqual(
      Array.from(terrain.bedrockMap),
      Array.from(terrain.heightMap),
    );
    assert.deepEqual(
      Array.from(terrain.originalHeightMap),
      Array.from(terrain.heightMap),
    );
  });

  test("reset restores height/bedrock from originalHeightMap and zeroes the rest", () => {
    const terrain = new Terrain(makeFacade({ terrainSize: 4 }));
    terrain.generate();
    terrain.sedimentMap.fill(5);
    terrain.dischargeMap.fill(3);

    terrain.reset();

    assert.deepEqual(
      Array.from(terrain.heightMap),
      Array.from(terrain.originalHeightMap),
    );
    assert.deepEqual(
      Array.from(terrain.bedrockMap),
      Array.from(terrain.originalHeightMap),
    );
    assert.ok(terrain.sedimentMap.every((v) => v === 0));
    assert.ok(terrain.dischargeMap.every((v) => v === 0));
  });
});

describe("Terrain.getBoundsForMode", () => {
  test("routes to the matching cached bound, defaulting to [0,1]", () => {
    const terrain = new Terrain(makeFacade({ terrainSize: 4 }));
    terrain.generate();
    assert.deepEqual(
      terrain.getBoundsForMode("height"),
      terrain.bounds.height,
    );
    assert.deepEqual(terrain.getBoundsForMode("unknown"), { min: 0, max: 1 });
  });
});
