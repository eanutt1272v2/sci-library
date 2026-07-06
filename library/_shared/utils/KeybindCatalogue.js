class KeybindCatalogue {
  static _catalogue = Object.freeze({
    fluvia: Object.freeze({
      sections: Object.freeze([
        {
          title: "Simulation",
          entries: Object.freeze([
            ["Space / Enter / P", "Pause / resume simulation"],
            ["G / R", "Generate / reset terrain"],
            ["I / K", "Droplets per frame +/-"],
            ["Ctrl+U / Ctrl+J", "Max age +/- 16"],
            ["Ctrl+Y / Ctrl+H", "Min volume +/- 0.001"],
          ]),
        },
        {
          title: "Rendering",
          entries: Object.freeze([
            ["1 / 2", "Switch render method: 2D / 3D"],
            ["O / L", "Toggle statistics / legend overlays"],
            ["C", "Cycle colour map (Shift reverse)"],
            ["M", "Cycle surface map (Shift reverse)"],
            ["[ / ]", "Height scale -/+ (Shift large)"],
            ["Ctrl+1 / 2 / 3", "Terrain size 128 / 256 / 512 + regenerate"],
            ["Ctrl+[ / Ctrl+]", "Noise scale -/+ (Shift coarse)"],
            ["Ctrl+; / Ctrl+'", "Noise octaves -/+ 1"],
            ["Ctrl+, / Ctrl+.", "Specular intensity -/+ 10"],
          ]),
        },
        {
          title: "Camera",
          entries: Object.freeze([
            ["WASD / Arrow", "Orbit camera (3D mode)"],
            ["Q / E / - / +", "Zoom camera out / in (3D mode)"],
            ["Mouse Drag / Wheel", "Orbit / zoom camera"],
          ]),
        },
        {
          title: "Media",
          entries: Object.freeze([
            ["Ctrl+R", "Start / stop recording"],
            ["Ctrl+S", "Export image"],
            ["Ctrl+Shift+U", "Import heightmap"],
            ["Ctrl+Shift+I / Ctrl+Shift+P", "Import / export params (JSON)"],
            ["Ctrl+Shift+J / Ctrl+Shift+K", "Export statistics JSON / CSV"],
            ["Ctrl+Shift+W / Ctrl+Shift+Q", "Export / import world state"],
          ]),
        },
        {
          title: "Reference",
          entries: Object.freeze([
            ["H", "Toggle GUI panel"],
            ["#", "Toggle keymap reference"],
          ]),
        },
      ]),
      hints: Object.freeze({
        running: "Space/Enter/P",
        generate: "G",
        reset: "R",
        droplets: "I/K",
        maxAge: "Ctrl+U/J",
        minVolume: "Ctrl+Y/H",
        renderMethod: "1/2",
        surfaceMap: "M",
        colourMap: "C",
        heightScale: "[/]",
        terrainSize: "Ctrl+1/2/3",
        noiseScale: "Ctrl+[/]",
        noiseOctaves: "Ctrl+;/'",
        specularIntensity: "Ctrl+,/.",
        overlayStatistics: "O",
        overlayLegend: "L",
        importHeightmap: "Ctrl+Shift+U",
        importParams: "Ctrl+Shift+I",
        importWorld: "Ctrl+Shift+Q",
        exportParams: "Ctrl+Shift+P",
        exportStatistics: "Ctrl+Shift+J",
        exportStatisticsCsv: "Ctrl+Shift+K",
        exportWorld: "Ctrl+Shift+W",
        toggleGUI: "H",
        orbitLeft: "A/\u2190",
        orbitRight: "D/\u2192",
        orbitUp: "W/\u2191",
        orbitDown: "S/\u2193",
        zoomOutCamera: "Q/-",
        zoomInCamera: "E/+",
        record: "Ctrl+R",
        exportImage: "Ctrl+S",
        keymapReference: "#",
      }),
    }),
    psi: Object.freeze({
      sections: Object.freeze([
        {
          title: "Quantum",
          entries: Object.freeze([
            ["W/S", "Increment/decrement n"],
            ["D/A", "Increment/decrement l"],
            ["E/Q", "Increment/decrement m"],
            ["R/T", "Nuclear charge Z +/- 1"],
            ["P", "Toggle reduced mass"],
            ["G/B", "log10 nucleus mass +/- 0.01"],
          ]),
        },
        {
          title: "View",
          entries: Object.freeze([
            ["1 / 2 / 3", "Switch plane: XY / XZ / YZ"],
            ["Z", "Reset view radius"],
            ["Space", "Reset slice offset"],
            ["X", "Reset view centre"],
            ["I / K", "Decrease / increase view radius"],
            ["Shift+J / Shift+L", "Decrease / increase slice offset"],
            ["Shift+A / Shift+D", "Pan X -/+"],
            ["Shift+W / Shift+S", "Pan Y -/+"],
            ["Shift+Q / Shift+E", "Pan Z -/+"],
            ["Arrow Keys", "Left/right slice offset, up/down view radius"],
            ["Shift+Arrow", "Pan in active plane"],
            ["Mouse Drag / Touch", "Pan view"],
            ["Wheel / Pinch", "Zoom radius"],
          ]),
        },
        {
          title: "Rendering",
          entries: Object.freeze([
            ["C", "Cycle colour map"],
            ["[ / ]", "Log-\u03b3 normalisation alpha -/+ 10"],
            ["M", "Toggle pixel smoothing"],
            ["O", "Toggle overlay"],
            ["N", "Toggle detected node overlay"],
            ["L", "Toggle legend"],
            ["-  / +", "Decrease / increase resolution"],
            ["H", "Toggle GUI"],
          ]),
        },
        {
          title: "Data",
          entries: Object.freeze([
            ["Ctrl+R", "Start / stop recording"],
            ["Ctrl+S", "Export image"],
            ["Ctrl+Shift+I / Ctrl+Shift+P", "Import / export params (JSON)"],
            ["Ctrl+Shift+S / Ctrl+Shift+C", "Export statistics JSON / CSV"],
          ]),
        },
        {
          title: "Reference",
          entries: Object.freeze([["#", "Toggle keymap reference"]]),
        },
      ]),
      hints: Object.freeze({
        quantumN: "W/S",
        quantumL: "D/A",
        quantumM: "E/Q",
        nuclearCharge: "R/T",
        reducedMass: "P",
        nucleusMass: "G/B",
        colourMap: "C",
        logAlpha: "[/]",
        resolution: "+/-",
        smoothing: "M",
        overlay: "O",
        nodeOverlay: "N",
        legend: "L",
        toggleGUI: "H",
        viewRadius: "I/K",
        sliceOffset: "Shift+J/L",
        panX: "Shift+A/D",
        panY: "Shift+W/S",
        panZ: "Shift+Q/E",
        resetViewRadius: "Z",
        slicePlane: "1/2/3",
        resetSliceOffset: "Space",
        resetViewCentre: "X",
        importParams: "Ctrl+Shift+I",
        exportParams: "Ctrl+Shift+P",
        exportStatistics: "Ctrl+Shift+S",
        exportStatisticsCsv: "Ctrl+Shift+C",
        record: "Ctrl+R",
        exportImage: "Ctrl+S",
        keymapReference: "#",
      }),
    }),
    cellular: Object.freeze({
      sections: Object.freeze([
        {
          title: "Simulation",
          entries: Object.freeze([
            ["H", "Toggle UI panels"],
            ["R", "Restart simulation"],
            ["Enter / P / Space", "Pause or play simulation"],
            ["#", "Toggle keymap reference"],
          ]),
        },
        {
          title: "Data",
          entries: Object.freeze([
            ["Ctrl+R", "Start / stop recording"],
            ["Ctrl+S", "Export image"],
            ["Ctrl+Shift+I / Ctrl+Shift+P", "Import / export params (JSON)"],
            ["Ctrl+Shift+J / Ctrl+Shift+K", "Export statistics JSON / CSV"],
            ["Ctrl+Shift+O / Ctrl+Shift+S", "Import / export state (JSON)"],
          ]),
        },
        {
          title: "Parameters",
          entries: Object.freeze([
            ["1 / 2", "Alpha a -/+"],
            ["3 / 4", "Beta b -/+"],
            ["5 / 6", "Gamma g -/+"],
            ["7 / 8", "Radius r -/+"],
            ["9 / 0", "Trail alpha t -/+"],
            ["- / =", "Density p -/+"],
            ["[ / ]", "Particles -/+ (restart to apply)"],
            ["Hold Shift", "Apply 10x change step"],
            ["Click value", "Start typing numeric input"],
            ["Enter / Esc", "Apply / cancel typed input"],
          ]),
        },
      ]),
      hints: Object.freeze({
        pause: "Enter/P/Space",
        restart: "R",
        toggleUI: "H",
        alpha: "1/2",
        beta: "3/4",
        gamma: "5/6",
        radius: "7/8",
        trailAlpha: "9/0",
        density: "-/=",
        particleCount: "[/]",
        paramsImport: "Ctrl+Shift+I",
        paramsExport: "Ctrl+Shift+P",
        statisticsExportJson: "Ctrl+Shift+J",
        statisticsExportCsv: "Ctrl+Shift+K",
        stateImport: "Ctrl+Shift+O",
        stateExport: "Ctrl+Shift+S",
        record: "Ctrl+R",
        exportImage: "Ctrl+S",
        keymapReference: "#",
      }),
    }),
  });

  static _cloneSections(sections) {
    return sections.map((section) => ({
      title: String(section.title || ""),
      entries: (section.entries || []).map((entry) => [
        String(entry?.[0] || ""),
        String(entry?.[1] || ""),
      ]),
    }));
  }

  static getSections(sketchId) {
    const sketch =
      KeybindCatalogue._catalogue[String(sketchId || "").toLowerCase()];
    if (!sketch || !Array.isArray(sketch.sections)) return [];
    return KeybindCatalogue._cloneSections(sketch.sections);
  }

  static getHint(sketchId, hintId, fallback = "") {
    const sketch =
      KeybindCatalogue._catalogue[String(sketchId || "").toLowerCase()];
    const hints = sketch?.hints || null;
    if (!hints) return fallback;

    const key = String(hintId || "");
    if (Object.prototype.hasOwnProperty.call(hints, key)) {
      const value = hints[key];
      return typeof value === "string" ? value : fallback;
    }

    return fallback;
  }

  static withHint(baseLabel, sketchId, hintId, fallback = "") {
    const label = String(baseLabel || "");
    const hint = KeybindCatalogue.getHint(sketchId, hintId, fallback);
    return hint ? `${label} (${hint})` : label;
  }

  static _comboCache = new Map();

  static _modAlias(token) {
    const normalised = String(token || "")
      .trim()
      .toLowerCase();
    if (normalised === "ctrl") return "control";
    if (normalised === "cmd") return "meta";
    return normalised;
  }

  static _parseCombo(raw) {
    const cached = KeybindCatalogue._comboCache.get(raw);
    if (cached) return cached;

    const parts = String(raw || "")
      .split("+")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    const mods = new Set();
    let key = "";

    for (let i = 0; i < parts.length; i++) {
      const p = KeybindCatalogue._modAlias(parts[i]);
      if (p === "shift" || p === "control" || p === "alt" || p === "meta") {
        mods.add(p);
      } else {
        key = p;
      }
    }

    const result = { mods, key };
    KeybindCatalogue._comboCache.set(raw, result);
    return result;
  }

  static _normaliseKeyForMatch(rawKey) {
    const s = String(rawKey || "").trim();
    if (s.length === 1) return s.toLowerCase();
    return s.toLowerCase();
  }

  static matchHint(sketchId, hintId, keyValue, kCode, event, optionIndex) {
    const hint = KeybindCatalogue.getHint(sketchId, hintId, "");
    if (!hint) return false;

    const options = hint.split("/").map((s) => s.trim());
    const idx = optionIndex ?? 0;
    const target = options[idx];
    if (!target) return false;

    const { mods, key } = KeybindCatalogue._parseCombo(target);

    const eventCtrl = event?.ctrlKey || event?.metaKey || false;
    const eventShift = event?.shiftKey || false;
    const eventAlt = event?.altKey || false;

    if (mods.has("control") !== eventCtrl) return false;
    if (mods.has("shift") !== eventShift) return false;
    if (mods.has("alt") !== eventAlt) return false;

    const normKey = KeybindCatalogue._normaliseKeyForMatch(keyValue);
    if (normKey === key) return true;

    if (kCode !== undefined && kCode !== null) {
      const codeStr = String(kCode);
      if (codeStr === key) return true;
    }

    return false;
  }

  static matchHintIndex(sketchId, hintId, keyValue, kCode, event) {
    const hint = KeybindCatalogue.getHint(sketchId, hintId, "");
    if (!hint) return -1;

    const options = hint.split("/").map((s) => s.trim());
    for (let i = 0; i < options.length; i++) {
      if (
        KeybindCatalogue.matchHint(sketchId, hintId, keyValue, kCode, event, i)
      ) {
        return i;
      }
    }
    return -1;
  }

  static getHintKey(sketchId, hintId, optionIndex = 0) {
    const hint = KeybindCatalogue.getHint(sketchId, hintId, "");
    if (!hint) return "";
    const options = hint.split("/").map((s) => s.trim());
    return options[optionIndex] || "";
  }
}
