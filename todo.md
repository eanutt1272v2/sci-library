# Psi Codebase — Development Record

> Internal working document. Gitignored — never pushed to remote history.
> Updated after every commit session.

---

## Issue Tracker

### DONE

| # | Issue | Commit(s) |
|---|-------|-----------|
| 1 | Replace arbitrary power-law (exposure) tone-mapping with stable log-gamma normalisation using alpha parameter | 649aca1 |
| 2 | Remove `params.exposure` and `adjustExposure()` from AppCore; strip from `_sanitiseRenderParams` | a3db86c |
| 3 | Remove Exposure binding from GUI Rendering tab | e00154d |
| 4 | Remove Exposure key-hold block from InputHandler `handleContinuousInput` | d15e5c1 |
| 5 | Remove Exposure hint from KeybindCatalogue | 1904c42 |
| 6 | Fix `_getCanonicalViewRadius`: replace bare ⟨r⟩ proxy with outer-lobe heuristic r_outer ≈ (n²/Z)(2n+1)/(n+ℓ+1) | a3db86c |
| 7 | Rename `QuantumMath.js` → `QMath.js`; move from `_shared/` to `modules/math/` | 6f24282 |
| 8 | Delete old `QuantumMath.js` from `_shared/` | f686f88 |
| 9 | Relink `QMath.js` script tag in `index.html` | 332c757 |
| 10 | Update `PsiWorker.js` importScripts path + `globalThis.QMath` reference | 2b75e85 |
| 11 | Expose `logAlpha` param in Renderer; hard-code overlay opacity to 1.0; use matplotlib C3 red / C0 blue node colours | 86bb282 |
| 12 | Add `logAlpha` to AppCore params; remove `nodeOverlayAlpha` and `adjustNodeOverlayAlpha` | 2ece36c |
| 13 | Add `logAlpha` slider under colour-map dropdown in GUI; remove nodeOverlayAlpha slider | fc091c5 |
| 14 | Replace nodeOverlayAlpha key controls with `[`/`]` for logAlpha in InputHandler | e9e7bf7 |
| 15 | Update KeybindCatalogue: add `[/]` logAlpha hint, remove nodeOverlayAlpha hint | 187a083 |
| 16 | Fix `QMath` rename residue in Analyser (six call sites still referenced old global `QuantumMath.*`) | dc0f0a3 |
| 17 | Widen `includeAnalysis` gate + `_applyWorkerAnalysis` guard so node overlay works independently of stats overlay | 25daff3, dc0f0a3 |
| 18 | Toggle methods (`toggleNodeOverlay`, etc.) now call `requestRender()`; remove stale no-op toggles | 2b35b16 |
| 19 | Analyser: remove dead `updateStatistics`, `_computeRadialProbabilityMoments`, `_estimateOrbitalNodeCount3D`; cache `computeNodeOverlayData` by (n,l,m,Z); fix `shift()` → `splice()` for O(1) trim | 24b425c |
| — | AppCore: cache `_getCanonicalViewRadius` by (n,l,Z); remove phantom `density` field from statistics; clean `_queueAction` to plain boolean | 98e7d10 |
| — | Worker: remove redundant `density` field from `computeDensityStatistics` | 54887e6 |
| — | Renderer: remove dead `axisSamples`/`getSliceAxes`; fix `_createReadbackBuffer`; cache log-alpha denom; static `SUPERSCRIPT_MAP` and `DENSITY_FLOOR`; `_screenPoint` scratch; explicit `+` sign strip in `_fmtSci`; legend gradient cache | 5df5485, 0077910 |

---

### TODO / OPEN

_All 19 tracked issues are resolved. The rows below track any newly discovered issues._

| # | Issue | Priority | Notes |
|---|-------|----------|-------|
| 20 | Audit `_fmtSci` duplicate fix — two commits (5df5485 and 0077910) both claim to fix `+` sign stripping; verify the second supersedes the first cleanly and there is no double-strip edge case | Medium | |
| 21 | Verify `_createReadbackBuffer` fix in Renderer is robust — confirm correct pixel buffer size allocation for all supported grid resolutions | Medium | |
| 22 | `computeNodeOverlayData` cache invalidation — confirm cache key (n,l,m,Z) is invalidated correctly when Z changes at runtime | Low | |

---

## Commit Log Summary

| SHA (short) | Message summary | Date |
|-------------|-----------------|------|
| 0077910 | fix(renderer): dead getSliceAxes; legend gradient cache; explicit + strip in _fmtSci (issues 4, 14, 18) | 2026-06-25 |
| 98e7d10 | perf(appcore): cache _getCanonicalViewRadius; remove phantom density field; clean _queueAction | 2026-06-25 |
| 54887e6 | fix(worker): remove redundant density field from computeDensityStatistics | 2026-06-25 |
| 5df5485 | fix(renderer): dead axisSamples/getSliceAxes; _createReadbackBuffer; log-alpha denom cache; static maps | 2026-06-25 |
| 24b425c | fix(analyser): remove dead code; cache computeNodeOverlayData; fix shift()→splice() | 2026-06-25 |
| 2b35b16 | fix: toggle methods call requestRender(); remove stale no-op toggles | 2026-06-25 |
| 8d093e2 | chore: strip all comments from Renderer.js, AppCore.js, Analyser.js | 2026-06-25 |
| 1143717 | refactor(Renderer): eliminate redundant colour intermediates; unify logAlpha readout; NODE_KEY_PANEL_OFFSET | 2026-06-24 |
| 25daff3 | fix(AppCore): widen includeAnalysis gate; align _applyWorkerAnalysis guard | 2026-06-24 |
| c4e9e55 | refactor(analyser): remove dead updateStatistics, _computeRadialProbabilityMoments, _estimateOrbitalNodeCount3D | 2026-06-24 |
| dc0f0a3 | fix: rename QuantumMath→QMath in Analyser; widen includeAnalysis gate for renderNodeOverlay | 2026-06-24 |
| 187a083 | feat(KeybindCatalogue): add logAlpha [/] hint, remove nodeOverlayAlpha hint | 2026-06-24 |
| e9e7bf7 | feat(InputHandler): replace nodeOverlayAlpha keys with logAlpha [ and ] | 2026-06-24 |
| fc091c5 | feat(GUI): add logAlpha slider under colour map dropdown, remove nodeOverlayAlpha slider | 2026-06-24 |
| 2ece36c | feat(AppCore): add logAlpha param, remove nodeOverlayAlpha and adjustNodeOverlayAlpha | 2026-06-24 |
| 86bb282 | feat(Renderer): expose logAlpha; remove nodeOverlayAlpha; opacity 1.0; matplotlib red/blue | 2026-06-24 |
| 2b75e85 | refactor(PsiWorker): importScripts QMath.js; reference global.QMath | 2026-06-24 |
| 332c757 | refactor(Psi): relink QMath.js from modules/math/; remove old QuantumMath script tag | 2026-06-24 |
| f686f88 | refactor(Psi): remove QuantumMath.js from _shared | 2026-06-24 |
| 6f24282 | refactor(Psi): rename QuantumMath→QMath, move to modules/math/ | 2026-06-24 |
