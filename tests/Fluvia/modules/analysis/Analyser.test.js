import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { Analyser } from "../../../../library/Fluvia/modules/analysis/Analyser.js";

function makeStatistics() {
  return {
    fps: 0,
    frameCounter: 0,
    simulationTime: 0,
    heightHistogram: new Int32Array(256),
    normHistogram: new Float32Array(256),
    avgElevation: 0,
    elevationStdDev: 0,
    heightBounds: { min: 0, max: 0 },
    totalWater: 0,
    totalSediment: 0,
    totalBedrock: 0,
    sedimentBounds: { min: 0, max: 0 },
    activeWaterCover: 0,
    drainageDensity: 0,
    dischargeBounds: { min: 0, max: 0 },
    hydraulicResidence: 0,
    rugosity: 0,
    slopeComplexity: 0,
    sedimentFlux: 0,
    erosionRate: 0,
    compositeWaterCoveragePct: 0,
    compositeSedimentCoveragePct: 0,
    compositeFlatCoveragePct: 0,
    compositeSteepCoveragePct: 0,
    compositeMeanSlopeWeight: 0,
    compositeMeanSedimentAlpha: 0,
    compositeMeanWaterAlpha: 0,
  };
}

function makeFacade(overrides = {}) {
  return {
    statistics: makeStatistics(),
    params: { running: true },
    terrain: { size: 4, area: 16, heightMap: new Float32Array(16) },
    p: { frameRate: () => 60 },
    ...overrides,
  };
}

describe("Analyser construction / reinitialise", () => {
  test("takes its facade fields directly, not an appcore back-reference", () => {
    const analyser = new Analyser(makeFacade());
    assert.equal(analyser.appcore, undefined);
    assert.equal(typeof analyser.statistics, "object");
    assert.equal(typeof analyser.p, "object");
  });

  test("terrain is read live from the facade (reflects reassignment)", () => {
    const facade = makeFacade();
    const analyser = new Analyser(facade);
    const newTerrain = { size: 8, area: 64 };
    facade.terrain = newTerrain;
    assert.equal(analyser.terrain, newTerrain);
  });

  test("reinitialise zeroes every statistic", () => {
    const facade = makeFacade();
    facade.statistics.rugosity = 5;
    facade.statistics.heightBounds.max = 10;
    const analyser = new Analyser(facade);
    analyser.statistics.rugosity = 5;
    analyser.statistics.heightBounds.max = 10;
    analyser.reinitialise();
    assert.equal(analyser.statistics.rugosity, 0);
    assert.equal(analyser.statistics.heightBounds.max, 0);
    assert.equal(analyser.statistics.frameCounter, 0);
  });
});

describe("Analyser.update", () => {
  test("reads fps via p.frameRate() and increments the frame counter", () => {
    const analyser = new Analyser(makeFacade());
    analyser.update();
    assert.equal(analyser.statistics.fps, 60);
    assert.equal(analyser.statistics.frameCounter, 1);
    analyser.update();
    assert.equal(analyser.statistics.frameCounter, 2);
  });
});

describe("Analyser.applyWorkerAnalysis", () => {
  test("ignores a non-object payload", () => {
    const analyser = new Analyser(makeFacade());
    assert.doesNotThrow(() => analyser.applyWorkerAnalysis(null));
    assert.doesNotThrow(() => analyser.applyWorkerAnalysis(42));
  });

  test("copies finite numeric fields onto statistics", () => {
    const analyser = new Analyser(makeFacade());
    analyser.applyWorkerAnalysis({
      avgElevation: 0.5,
      totalWater: 12,
      erosionRate: NaN,
    });
    assert.equal(analyser.statistics.avgElevation, 0.5);
    assert.equal(analyser.statistics.totalWater, 12);
    assert.equal(analyser.statistics.erosionRate, 0);
  });

  test("copies histogram ArrayBuffers into typed arrays of the target length", () => {
    const analyser = new Analyser(makeFacade());
    const buf = new Int32Array(256).fill(3).buffer;
    analyser.applyWorkerAnalysis({ heightHistogram: buf });
    assert.equal(analyser.statistics.heightHistogram.length, 256);
    assert.equal(analyser.statistics.heightHistogram[0], 3);
  });

  test("updates bounds sub-objects when present", () => {
    const analyser = new Analyser(makeFacade());
    analyser.applyWorkerAnalysis({
      heightBounds: { min: -1, max: 2 },
      sedimentBounds: { min: 0, max: 1 },
    });
    assert.deepEqual(analyser.statistics.heightBounds, { min: -1, max: 2 });
    assert.deepEqual(analyser.statistics.sedimentBounds, { min: 0, max: 1 });
  });
});

describe("Analyser.getAverageHeightInRegion / getHypsometricIntegral", () => {
  test("computes the average height within a normalised region", () => {
    const heightMap = new Float32Array(16).fill(2);
    const analyser = new Analyser(
      makeFacade({ terrain: { size: 4, area: 16, heightMap } }),
    );
    assert.equal(analyser.getAverageHeightInRegion(0, 0, 1), 2);
  });

  test("getHypsometricIntegral is 0 when the histogram is empty", () => {
    const analyser = new Analyser(makeFacade());
    assert.equal(analyser.getHypsometricIntegral(0.5), 0);
  });
});
