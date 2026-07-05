/**
 * PSI_SCHEMA — the single source of truth for every persistent Psi parameter.
 *
 * Consumed by ParamStore (defaults, coercion, clamping), the GUI (slider
 * bounds via `store.getRange` / `schema[key].step`), `InputHandler` (keyboard
 * nudges route through `store.set`, which clamps), and the worker payload. A
 * range therefore lives in exactly one place here instead of being re-declared
 * (and drifting) across those four surfaces.
 *
 * Bounds notes:
 *  - `l` is bounded `0..n-1` and `m` is bounded `-l..l` via {@link ParamStore}'s
 *    relative-bound form `{ key, offset }` / `{ key, sign }`, resolved live on
 *    every `set()` so a dependent range tracks its referent.
 *  - `sliceOffset` is bounded `±viewRadius` the same way.
 *  - Numeric ranges were reconciled against the GUI slider config,
 *    `InputHandler`'s clamps, `AppCore`'s sanitiser, and `PsiWorker`'s clamp,
 *    adopting the value at least two of those surfaces already agreed on
 *    (resolution 64-512, n 1-12, viewCentre ±1024).
 *
 * The `colourMap` option list is supplied at runtime via the store's
 * `dynamicOptions` (loaded from `colour-maps.json`), not hardcoded here.
 *
 * `viewCentre` is stored as three flat scalar keys (`viewCentre.x/y/z`) and
 * re-exposed as a nested object through {@link ParamStore#asObject}.
 */
const PSI_SCHEMA = {
  // --- Quantum numbers ---
  n: { default: 3, type: "int", min: 1, max: 12, step: 1, label: "Principal n" },
  l: {
    default: 1,
    type: "int",
    min: 0,
    max: { key: "n", offset: -1 },
    step: 1,
    label: "Angular l",
  },
  m: {
    default: 0,
    type: "int",
    min: { key: "l", sign: -1 },
    max: { key: "l", sign: 1 },
    step: 1,
    label: "Magnetic m",
  },

  // --- Atom / physics ---
  nuclearCharge: {
    default: 1,
    type: "int",
    min: 1,
    max: 20,
    step: 1,
    label: "Nuclear Charge Z",
  },
  nucleusMassKg: {
    default: 1.67262192369e-27,
    type: "float",
    min: 1e-33,
    max: 1e-20,
    label: "Nucleus Mass [kg]",
  },
  useReducedMass: { default: true, type: "bool", label: "Reduced Mass" },

  // --- Sampling / tone mapping ---
  resolution: {
    default: 400,
    type: "int",
    min: 64,
    max: 512,
    step: 2,
    label: "Resolution",
  },
  logAlpha: {
    default: 200,
    type: "float",
    min: 1,
    max: 2000,
    step: 1,
    label: "Log-γ Alpha α",
  },

  // --- Appearance ---
  colourMap: { default: "rocket", type: "enum", label: "Colour Map" },
  pixelSmoothing: { default: true, type: "bool", label: "Pixel Smoothing" },
  renderLegend: { default: true, type: "bool", label: "Legend" },
  renderOverlay: { default: false, type: "bool", label: "Statistics Overlay" },
  renderNodeOverlay: { default: false, type: "bool", label: "Node Overlay" },
  renderKeymapRef: { default: false, type: "bool", label: "Keymap Reference" },

  // --- Slice view ---
  viewRadius: {
    default: 45,
    type: "float",
    min: 1,
    max: 256,
    label: "View Radius [a₀]",
  },
  slicePlane: { default: "xz", type: "enum", options: ["xy", "xz", "yz"], label: "Slice Plane" },
  sliceOffset: {
    default: 0,
    type: "float",
    min: { key: "viewRadius", sign: -1 },
    max: { key: "viewRadius", sign: 1 },
    label: "Slice Offset [a₀]",
  },
  "viewCentre.x": { default: 0, type: "float", min: -1024, max: 1024, step: 0.1, label: "Pan X [a₀]" },
  "viewCentre.y": { default: 0, type: "float", min: -1024, max: 1024, step: 0.1, label: "Pan Y [a₀]" },
  "viewCentre.z": { default: 0, type: "float", min: -1024, max: 1024, step: 0.1, label: "Pan Z [a₀]" },

  // --- Media / export ---
  imageFormat: {
    default: "png",
    type: "enum",
    options: ["png", "jpg", "jpeg", "webp"],
    label: "Image Format",
  },
  recordingFPS: {
    default: 60,
    type: "int",
    min: 12,
    max: 120,
    step: 1,
    label: "Recording FPS [Hz]",
  },
  videoBitrateMbps: {
    default: 8,
    type: "float",
    min: 1,
    max: 64,
    step: 0.5,
    label: "Video Bitrate [Mbps]",
  },
};

export { PSI_SCHEMA };
