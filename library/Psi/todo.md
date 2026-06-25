# Psi Codebase — Development Record

All items from the 25 Jun 2026 full audit + supplementary list.
Format: `[x]` done · `[ ]` pending · `[-]` skipped/deferred

---

## Previous session (already landed)

- [x] Rename `QuantumMath.js` → `QMath.js`, move to `modules/math/`, relink everywhere
- [x] Remove `nodeOverlayAlpha` parameter + slider + key controls entirely
- [x] Expose `logAlpha` as slider under colour-map dropdown (GUI), keyboard `[`/`]` ±10
- [x] Node overlay always renders at 1.0 opacity
- [x] Node overlay colours → matplotlib C3 red [214,39,40] + C0 blue [31,119,180]
- [x] Widen `includeAnalysis` gate to trigger when `renderNodeOverlay` is true
- [x] Widen `_applyWorkerAnalysis` guard symmetrically
- [x] Strip superfluous comments from Renderer, AppCore, Analyser
- [x] Pre-cache `Math.log(1 + alpha)` via `_prepareLogCache()` / `_cachedLogDenom`
- [x] `_worldToScreen` reuses scratch object `_screenPoint` — no per-call allocation
- [x] Angular node cones use `beginShape/vertex/endShape` polylines, not individual `line()` calls
- [x] Legend gradient cached to offscreen `<canvas>`, rebuilt only on colourMap/logAlpha change
- [x] `SUPERSCRIPT_MAP` promoted to static class property
- [x] `_fmtSci` strips `+` from exponent string explicitly
- [x] `_getCanonicalViewRadius` result cached against `(n, l, Z)` tuple
- [x] `DENSITY_FLOOR = 1e-30` static constant on Renderer
- [x] `computeNodeOverlayData` result cached inside Analyser on `(n, l, mAbs, z, toA0)` key

---

## This session — Audit issues to resolve

### Correctness (High priority)

- [ ] #1  Delete `_computeRadialProbabilityMoments` + `_estimateOrbitalNodeCount3D` from Analyser (dead, lower-quality duplicates of worker versions)
- [ ] #2  Delete `updateStatistics` from Analyser (dead code, maintenance trap)
- [ ] #3  Delete `this.axisSamples`, `this.axisSampleCache`, `getAxisSamples` from Renderer (dead scaffolding)
- [ ] #4  Delete `getSliceAxes` from Renderer (duplicate of worker version, never called)
- [ ] #5  Fix `_createReadbackBuffer` — `willReadFrequently` hint applied via `buffer.elt.getContext()` AFTER creation (already landed; verify)
- [ ] #6  Remove `density` phantom field from `statistics` schema in AppCore + Analyser; remove `density` binding from GUI Statistics tab

### Architecture

- [ ] #7  Replace `Array.shift()` in `recordStatistics` with `splice(0,1)` (already done in current Analyser — verify is splice not shift)
- [ ] #8  Replace `_queueAction` filter-array pattern with single `_renderQueued` boolean (already done — verify)
- [ ] #9  Separate `syncMediaControls` from routine `refreshGUI` path; only call on media state change
- [ ] #10 (already done — `_getCanonicalViewRadius` cache confirmed)
- [ ] #11 (already done — `_screenPoint` scratch confirmed)

### Performance

- [ ] #12 (already done — `_prepareLogCache` / `_cachedLogDenom` confirmed)
- [ ] #13 `constrain()` in pixel loop → `Math.min(grid[i] / peakRef, 1)` (already done — verify renderToBuffer)
- [ ] #14 (already done — legend gradient cache confirmed)
- [ ] #15 (already done — `beginShape/endShape` polylines confirmed)

### Minor / Style

- [ ] #16 `DENSITY_FLOOR` named constant (already done — verify all 3 files use it)
- [ ] #17 `SUPERSCRIPT_MAP` static property (already done — confirmed)
- [ ] #18 `_fmtSci` explicit `+` strip (already done — confirmed)
- [ ] #19 `computeNodeOverlayData` caching (already done — confirmed)

### Supplementary list

- [ ] S1  `todo.md` + `.gitignore` entry ← **this commit**
- [ ] S2  GUI: remove bogus `statistics.density` binding from Statistics tab
- [ ] S3  GUI: move `renderNodeOverlay` toggle to Rendering tab / Visual Overlays folder
- [ ] S4  Renderer: guard `renderLegend` against `k = -Infinity` (when `maxV = DENSITY_FLOOR`)
- [ ] S5  AppCore: `syncViewConstraints` null-gui guard (already has it — verify)
- [ ] S6  Renderer / AppCore: apply loaded font asset in overlay text if font is present

---

## Commit log (this session)

| # | SHA (short) | Scope | Description |
|---|-------------|-------|-------------|
| 1 | pending     | chore | Add todo.md dev record (gitignored) |
