class ColourMapLUT {
  static GREYSCALE = {
    r: [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    g: [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    b: [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  };

  static buildLUT(colourMapData, lut, lutPacked, isLittleEndian) {
    if (!colourMapData) return;

    const channels = ["r", "g", "b"];

    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const idx = i * 3;

      for (let c = 0; c < 3; c++) {
        const coeffs = colourMapData[channels[c]];
        let val = 0;
        for (let j = coeffs.length - 1; j >= 0; j--) {
          val = val * t + coeffs[j];
        }
        lut[idx + c] = constrain(Math.round(val * 255), 0, 255);
      }

      if (lutPacked && isLittleEndian) {
        lutPacked[i] =
          lut[idx] | (lut[idx + 1] << 8) | (lut[idx + 2] << 16) | (255 << 24);
      }
    }
  }

  static sampleColour(colourMapData, t) {
    if (!colourMapData) return [255, 255, 255];

    const clamped = constrain(t, 0, 1);
    const channels = ["r", "g", "b"];
    const out = [0, 0, 0];

    for (let c = 0; c < 3; c++) {
      const coeffs = colourMapData[channels[c]];
      let val = 0;
      for (let j = coeffs.length - 1; j >= 0; j--) {
        val = val * clamped + coeffs[j];
      }
      out[c] = constrain(Math.round(val * 255), 0, 255);
    }

    return out;
  }

  static valueToColour(lut, val) {
    const v = Math.max(0, Math.min(1, val));
    const idx = Math.min(255, Math.max(0, Math.round(v * 255))) * 3;
    return [lut[idx], lut[idx + 1], lut[idx + 2]];
  }
}

// Stage 1 compatibility bridge: keeps this file working as a classic <script>
// global for consumers not yet migrated to ES modules. Remove once all
// consumers import it directly.
globalThis.ColourMapLUT = ColourMapLUT;

export { ColourMapLUT };
