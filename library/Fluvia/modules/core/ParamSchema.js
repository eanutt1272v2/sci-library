/**
 * FLUVIA_SCHEMA — the single source of truth for every Fluvia parameter.
 *
 * Each entry follows the {@link ParamStore} SchemaEntry shape
 * (`{default, type, min, max, step, label, options}`). Ranges here replace the
 * four independently-drifted range declarations that previously lived in
 * `GUI.js` (slider config), `InputHandler.js` (keyboard-nudge clamp),
 * `AppCore.js` (`_sanitiseParams` clamp) and `FluviaWorker.js` (defensive
 * clamp). Consumers now read bounds from this schema via the store's
 * `getRange(key)` rather than hardcoding them.
 *
 * Range reconciliation rule (applied mechanically): for each parameter the four
 * historical surfaces were compared and the range that two of them already
 * agreed on was adopted; the outlier surface was brought into line. Three
 * exceptions — `maxAge`, `minVolume`, `noiseScale` — were WIDENED to the
 * (broader) InputHandler+AppCore agreement rather than tightened to their stale,
 * narrow GUI sliders. Parameters with a genuine 3-way (or 2-surface) split and
 * no majority are marked `AMBIGUOUS` below and seeded with AppCore's former
 * runtime clamp (the value the app actually enforced each frame), pending a
 * human decision on the intended final range.
 *
 * The worker's own clamps in `FluviaWorker.js` are intentionally left wider as
 * defence-in-depth and are not treated as the canonical user-facing range.
 */
const FLUVIA_SCHEMA = {
  // --- Simulation toggles -----------------------------------------------------
  running: { default: true, type: "bool", label: "Running" },

  // --- Droplet settings -------------------------------------------------------
  // dropletsPerFrame: GUI 0-512 & InputHandler 0-512 agree (AppCore 0-2048 was
  // the outlier, tightened to match).
  dropletsPerFrame: {
    default: 256,
    type: "int",
    min: 0,
    max: 512,
    step: 1,
    label: "Droplets/Frame",
  },
  // maxAge: WIDENED — GUI slider was a stale 128-512; InputHandler + AppCore
  // already agreed on 8-2048, adopted.
  maxAge: { default: 500, type: "int", min: 8, max: 2048, step: 1, label: "Max Age" },
  // minVolume: WIDENED — GUI slider was a stale 0.001-0.1; InputHandler +
  // AppCore agreed on 1e-5..1, adopted.
  minVolume: {
    default: 0.01,
    type: "float",
    min: 1e-5,
    max: 1,
    step: 0.001,
    label: "Min Volume",
  },

  // --- Terrain generation -----------------------------------------------------
  // terrainSize stays an int bound to the smallest/largest allowed dimension;
  // snap-to-nearest-allowed (128/256/512) is enforced by
  // AppCore.normaliseTerrainSize, not by the store.
  terrainSize: { default: 256, type: "int", min: 128, max: 512, label: "Size" },
  // noiseScale: WIDENED — GUI slider was a stale 0.1-5; InputHandler + AppCore
  // agreed on 0.01-10, adopted.
  noiseScale: { default: 0.6, type: "float", min: 0.01, max: 10, label: "Scale" },
  // noiseOctaves: all surfaces agree 1-12.
  noiseOctaves: {
    default: 8,
    type: "int",
    min: 1,
    max: 12,
    step: 1,
    label: "Octaves",
  },
  // amplitudeFalloff: only AppCore declared a range (0-1); adopted.
  amplitudeFalloff: {
    default: 0.6,
    type: "float",
    min: 0,
    max: 1,
    label: "Amplitude Falloff",
  },

  // --- Hydraulic erosion ------------------------------------------------------
  // sedimentErosionRate / bedrockErosionRate / depositionRate: AppCore + worker
  // agree 0-1 (GUI's 0-0.2 slider was the outlier, widened to match).
  sedimentErosionRate: {
    default: 0.1,
    type: "float",
    min: 0,
    max: 1,
    label: "Sediment Erosion",
  },
  bedrockErosionRate: {
    default: 0.1,
    type: "float",
    min: 0,
    max: 1,
    label: "Bedrock Erosion",
  },
  depositionRate: { default: 0.1, type: "float", min: 0, max: 1, label: "Deposition" },
  // evaporationRate: max agrees at 1 across surfaces; min is AMBIGUOUS
  // (GUI 0.001 vs AppCore 1e-4 vs worker 1e-6, no majority). Seeded with
  // AppCore's former runtime min (1e-4).
  evaporationRate: {
    default: 0.001,
    type: "float",
    min: 0.0001,
    max: 1,
    step: 0.001,
    label: "Evaporation",
  },
  // precipitationRate: AppCore + worker agree 0-10 (GUI's 0-5 widened).
  precipitationRate: {
    default: 1,
    type: "float",
    min: 0,
    max: 10,
    label: "Precipitation",
  },
  // entrainment: AMBIGUOUS — GUI 0-10, AppCore 0-20, worker 0-50, no majority.
  // Seeded with AppCore's former runtime range (0-20).
  entrainment: { default: 1, type: "float", min: 0, max: 20, label: "Entrainment" },
  // gravity: min 0 agreed (AppCore + worker); max AMBIGUOUS (GUI 5, AppCore 10,
  // worker 20). Seeded with AppCore's former runtime max (10).
  gravity: { default: 1, type: "float", min: 0, max: 10, label: "Gravity" },
  // momentumTransfer: min 0 agreed; max AMBIGUOUS (GUI 4, AppCore 10, worker
  // 20). Seeded with AppCore's former runtime max (10).
  momentumTransfer: {
    default: 1,
    type: "float",
    min: 0,
    max: 10,
    label: "Momentum Transfer",
  },
  learningRate: { default: 0.1, type: "float", min: 0, max: 1, label: "Learning Rate" },

  // --- Thermal erosion --------------------------------------------------------
  // maxHeightDiff: AMBIGUOUS — GUI 0.01-1, AppCore 1e-4..2, worker 1e-5..4, no
  // majority. Seeded with AppCore's former runtime range (1e-4..2).
  maxHeightDiff: {
    default: 0.01,
    type: "float",
    min: 0.0001,
    max: 2,
    label: "Max Δ Height",
  },
  settlingRate: { default: 0.8, type: "float", min: 0, max: 1, label: "Settling Rate" },

  // --- Overlays ---------------------------------------------------------------
  renderStatistics: { default: true, type: "bool", label: "Statistics Overlay" },
  renderLegend: { default: true, type: "bool", label: "Legend" },
  renderKeymapRef: { default: false, type: "bool", label: "Keymap Reference" },

  // --- Rendering --------------------------------------------------------------
  renderMethod: {
    default: "3D",
    type: "enum",
    options: ["3D", "2D"],
    label: "Render Method",
  },
  // heightScale: GUI + InputHandler agree 1-256 (AppCore 1-1024 was the outlier).
  heightScale: { default: 100, type: "int", min: 1, max: 256, label: "Height Scale" },
  surfaceMap: {
    default: "composite",
    type: "enum",
    options: ["composite", "height", "slope", "discharge", "sediment", "delta"],
    label: "Surface Map",
  },
  // colourMap options are supplied at runtime (dynamicOptions) from the loaded
  // colour-map asset; this default is replaced by AppCore after load.
  colourMap: { default: "viridis", type: "enum", options: [], label: "Colour Map" },

  // --- Camera -----------------------------------------------------------------
  cameraSmoothing: {
    default: 0.82,
    type: "float",
    min: 0,
    max: 0.98,
    step: 0.01,
    label: "Motion Smoothing",
  },
  cameraOrbitSensitivity: {
    default: 0.007,
    type: "float",
    min: 0.001,
    max: 0.03,
    step: 0.0005,
    label: "Orbit Sensitivity",
  },
  cameraZoomSensitivity: {
    default: 0.5,
    type: "float",
    min: 0.05,
    max: 3,
    step: 0.05,
    label: "Zoom Sensitivity",
  },

  // --- Lighting ---------------------------------------------------------------
  // lightDir.{x,y,z}: AMBIGUOUS — GUI slider ±100 vs AppCore sanitiser ±1000,
  // the only two surfaces, and they disagree. Seeded with AppCore's former
  // runtime bound (±1000).
  "lightDir.x": { default: 50, type: "float", min: -1000, max: 1000 },
  "lightDir.y": { default: 50, type: "float", min: -1000, max: 1000 },
  "lightDir.z": { default: -50, type: "float", min: -1000, max: 1000 },
  // specularIntensity: InputHandler + AppCore agree 0-4096 (GUI's 0.01-1024 was
  // the outlier, brought into line).
  specularIntensity: {
    default: 100,
    type: "float",
    min: 0,
    max: 4096,
    label: "Specular Intensity",
  },

  // --- Colour palette ---------------------------------------------------------
  skyColour: { default: { r: 173, g: 183, b: 196 }, type: "color", label: "Sky" },
  steepColour: { default: { r: 115, g: 115, b: 95 }, type: "color", label: "Steep" },
  flatColour: { default: { r: 50, g: 81, b: 33 }, type: "color", label: "Flat" },
  sedimentColour: {
    default: { r: 201, g: 189, b: 117 },
    type: "color",
    label: "Sediment",
  },
  waterColour: { default: { r: 92, g: 133, b: 142 }, type: "color", label: "Water" },

  // --- Recording / export -----------------------------------------------------
  imageFormat: {
    default: "png",
    type: "enum",
    options: ["png", "jpg", "jpeg", "webp"],
    label: "Format",
  },
  recordingFPS: {
    default: 60,
    type: "int",
    min: 12,
    max: 120,
    step: 1,
    label: "Recording FPS",
  },
  videoBitrateMbps: {
    default: 8,
    type: "float",
    min: 1,
    max: 64,
    step: 0.5,
    label: "Video Bitrate",
  },
};

export { FLUVIA_SCHEMA };
