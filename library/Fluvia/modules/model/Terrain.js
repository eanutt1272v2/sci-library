class Terrain {
  constructor(appcore) {
    this.appcore = appcore;

    const { terrainSize } = this.appcore.params;
    this.size = terrainSize;
    this.area = terrainSize * terrainSize;

    this.heightMap = new Float32Array(this.area);
    this.originalHeightMap = new Float32Array(this.area);
    this.bedrockMap = new Float32Array(this.area);
    this.sedimentMap = new Float32Array(this.area);
    this.dischargeMap = new Float32Array(this.area);
    this.dischargeTrack = new Float32Array(this.area);
    this.momentumX = new Float32Array(this.area);
    this.momentumY = new Float32Array(this.area);
    this.momentumXTrack = new Float32Array(this.area);
    this.momentumYTrack = new Float32Array(this.area);

    this._float32Keys = Object.keys(this).filter(
      (k) => this[k] instanceof Float32Array,
    );

    this.sharedNormal = { x: 0, y: 0, z: 0 };
    this.bounds = {
      height: { min: 0, max: 1 },
      sediment: { min: 0, max: 0 },
      discharge: { min: 0, max: 0 },
    };
  }

  getIndex(x, y) {
    return y * this.size + x;
  }

  getHeight(x, y) {
    const { size, heightMap } = this;
    if (x < 0 || x >= size || y < 0 || y >= size) return 0;
    return heightMap[y * size + x];
  }

  updateTotalHeight(index) {
    this.heightMap[index] = this.bedrockMap[index] + this.sedimentMap[index];
  }

  getMapBounds(mapArray) {
    if (!mapArray || mapArray.length === 0) {
      return { min: 0, max: 0 };
    }

    let minVal = mapArray[0];
    let maxVal = mapArray[0];

    for (let i = 1, len = mapArray.length; i < len; i++) {
      const val = mapArray[i];
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }

    return { min: minVal, max: maxVal };
  }

  getDischargeBounds() {
    const { area, dischargeMap } = this;
    if (area <= 0 || !dischargeMap || dischargeMap.length === 0) {
      return { min: 0, max: 0 };
    }

    let first = this.getDischarge(0);
    let minVal = first;
    let maxVal = first;

    for (let i = 1; i < area; i++) {
      const d = this.getDischarge(i);
      if (d < minVal) minVal = d;
      if (d > maxVal) maxVal = d;
    }

    return { min: minVal, max: maxVal };
  }

  updateBoundsCache() {
    this.bounds.height = this.getMapBounds(this.heightMap);
    this.bounds.sediment = this.getMapBounds(this.sedimentMap);
    this.bounds.discharge = this.getDischargeBounds();
  }

  getBoundsForMode(mode) {
    if (mode === "height") return this.bounds.height;
    if (mode === "sediment") return this.bounds.sediment;
    if (mode === "discharge") return this.bounds.discharge;
    return { min: 0, max: 1 };
  }

  getSurfaceNormal(x, y) {
    const { size, heightMap, sharedNormal } = this;
    const { heightScale } = this.appcore.params;

    const west = x > 0 ? y * size + (x - 1) : y * size + x;
    const east = x < size - 1 ? y * size + (x + 1) : y * size + x;
    const north = y > 0 ? (y - 1) * size + x : y * size + x;
    const south = y < size - 1 ? (y + 1) * size + x : y * size + x;

    const deltaX = (heightMap[west] - heightMap[east]) * heightScale;
    const deltaZ = (heightMap[north] - heightMap[south]) * heightScale;
    const deltaY = 1.0;

    const mag = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);

    sharedNormal.x = deltaX / mag;
    sharedNormal.y = deltaY / mag;
    sharedNormal.z = deltaZ / mag;

    return sharedNormal;
  }

  getDischarge(index) {
    if (!this.dischargeMap || index < 0 || index >= this.dischargeMap.length) {
      return 0;
    }
    return this.codyErf(0.4 * this.dischargeMap[index]);
  }

  codyErf(x) {
    const absX = Math.abs(x);
    if (absX > 9.3) return x > 0 ? 1.0 : -1.0;

    let result;
    if (absX <= 0.84375) {
      const xSq = x * x;
      const p = [
        3.1611237438705656, 113.86415415105016, 377.485237685302,
        3209.3775891384695, 0.18577770618460315,
      ];
      const q = [
        23.601290953873412, 244.55303442692948, 1287.1751860847748,
        2844.2368334391706,
      ];

      const num =
        (((p[4] * xSq + p[0]) * xSq + p[1]) * xSq + p[2]) * xSq + p[3];
      const den = (((xSq + q[0]) * xSq + q[1]) * xSq + q[2]) * xSq + q[3];
      result = x * (num / den);
    } else if (absX <= 4.0) {
      const p = [
        0.5641884969886701, 8.883149794388376, 66.11542093743808,
        298.63513819740013, 881.9522212417691, 1712.0476126340706,
        2051.0783778260715, 1230.3393547979972, 2.1531153547440385e-8,
      ];
      const q = [
        15.744926110709835, 117.6939508913125, 537.1811018620099,
        1621.3895745386784, 3290.7992357334596, 4362.61909014206,
        3439.3676741437216, 1230.3393548037443,
      ];

      const n =
        (((((((p[8] * absX + p[0]) * absX + p[1]) * absX + p[2]) * absX +
          p[3]) *
          absX +
          p[4]) *
          absX +
          p[5]) *
          absX +
          p[6]) *
          absX +
        p[7];
      const d =
        (((((((absX + q[0]) * absX + q[1]) * absX + q[2]) * absX + q[3]) *
          absX +
          q[4]) *
          absX +
          q[5]) *
          absX +
          q[6]) *
          absX +
        q[7];

      result = 1.0 - Math.exp(-x * x) * (n / d);
      if (x < 0) result = -result;
    } else {
      result = x > 0 ? 1.0 : -1.0;
    }
    return result;
  }

  generate() {
    const { noiseScale, noiseOctaves, amplitudeFalloff } = this.appcore.params;
    const { size, area, heightMap, originalHeightMap, bedrockMap } = this;

    this.reset();

    noiseDetail(
      Math.max(1, noiseOctaves | 0),
      constrain(amplitudeFalloff, 0, 1),
    );
    const offsetX = random(100000);
    const offsetY = random(100000);
    const freq = noiseScale / 100;

    for (let i = 0; i < area; i++) {
      const x = i % size;
      const y = (i / size) | 0;

      const sx = x * freq + offsetX;
      const sy = y * freq + offsetY;
      const noiseVal = noise(sx, sy);
      heightMap[i] = Math.pow(noiseVal, 1.2);
    }

    const { min, max } = this.getMapBounds(heightMap);
    const range = max - min || 1;

    for (let i = 0; i < area; i++) {
      const norm = (heightMap[i] - min) / range;
      heightMap[i] = norm;
      bedrockMap[i] = norm;
      originalHeightMap[i] = norm;
    }

    this.updateBoundsCache();
  }

  reset() {
    const {
      heightMap,
      bedrockMap,
      originalHeightMap,
      sedimentMap,
      dischargeMap,
      dischargeTrack,
      momentumX,
      momentumY,
      momentumXTrack,
      momentumYTrack,
    } = this;

    [heightMap, bedrockMap].forEach((map) => map.set(originalHeightMap));

    [
      sedimentMap,
      dischargeMap,
      dischargeTrack,
      momentumX,
      momentumY,
      momentumXTrack,
      momentumYTrack,
    ].forEach((map) => map.fill(0));

    this.updateBoundsCache();
  }
}
