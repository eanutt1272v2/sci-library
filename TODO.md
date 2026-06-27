# Psi Refactor — Dev Record

> This file is gitignored in production. It is a raw working record, not documentation.

---

## Architecture Target

Three-layer unidirectional data flow:

```
ParamStore (state)
    ↓ snapshot()
WorkerBridge / PsiWorker (computation)
    ↓ typed result object
Renderer + Analyser + GUI (presentation)
    ↑ store.set() only (GUI writes back to state)
```

Full spec in query log (2026-06-27). Reference that for schema, layout config, and module responsibilities.

---

## Step Tracker

### Step 1 — ParamStore
- [x] `modules/core/ParamStore.js` written with `PSI_SCHEMA`
- [x] `get`, `set`, `snapshot`, `onChange`, `_coerce` all implemented
- [x] Schema covers: n, l, m, resolution, gridScale, logAlpha, colourMap, colourReverse, renderOverlay, renderNodeOverlay, showAxes, exportResolution
- [ ] AppCore not yet wired to store — still uses plain `this.params`

### Step 2 — Wire AppCore to ParamStore
- [ ] Replace `this.params = { ... }` with `this.store = new ParamStore(PSI_SCHEMA)`
- [ ] Replace all direct `this.params.x = y` mutations with `this.store.set(x, y)`
- [ ] Replace all `this.params.x` reads with `this.store.get(x)` (or pass snapshot to worker)
- [ ] Delete `_sanitiseRenderParams()`
- [ ] Delete all `adjustXxx()` methods from AppCore
- [ ] Worker dispatch: call `this.store.snapshot()` to build the message payload

### Step 3 — Schema-driven GUI
- [ ] Write `GUI_LAYOUT` config object (folder → key array mapping)
- [ ] Rewrite `GUI.js` to generate Tweakpane controls from `store.schema` + `GUI_LAYOUT`
- [ ] Delete all manual `addInput` / `addButton` boilerplate
- [ ] All GUI writes go through `store.set(key, value)` in a single generic change handler

### Step 4 — Schema-driven InputHandler
- [ ] Write `buildBindingsFromSchema(schema)` helper
- [ ] Rewrite `InputHandler.js` to derive keybindings from schema entries with `keybind` field
- [ ] Delete the if/else match chain
- [ ] Delete `KeybindCatalogue.js` (hints derived from schema at runtime)

### Step 5 — WorkerBridge
- [ ] Create `modules/worker/WorkerBridge.js`
- [ ] Move worker spawn, message dispatch, and response routing out of AppCore
- [ ] `includeAnalysis` flag computed inside WorkerBridge from `renderOverlay || renderNodeOverlay`
- [ ] Formalise inbound/outbound message schemas as documented constants

### Step 6 — Slim AppCore
- [ ] AppCore reduced to: instantiate modules, own rAF loop, call `_onWorkerResult`
- [ ] Target: under 150 lines
- [ ] All parameter logic, GUI construction, keybind wiring gone from AppCore

### Step 7 — Renderer / Analyser cleanup
- [ ] Renderer reads params from store snapshot passed at render time — no AppCore reference
- [ ] Analyser same: receives result object and store snapshot only
- [ ] Remove all `.appcore` back-references from Renderer and Analyser

### Step 8 — Fluvia (deferred)
- [ ] Read Fluvia source
- [ ] Define FLUVIA_SCHEMA
- [ ] Apply same 7-step pattern

---

## Known Issues / Debt (pre-refactor, carried over)

- `includeAnalysis` / `_applyWorkerAnalysis` asymmetry: widened fix in place but architectural fix
  lands in Step 5 (WorkerBridge owns the flag).
- Renderer still holds `this.appcore` reference — removed in Step 7.
- GUI and KeybindCatalogue both declare parameter ranges redundantly — removed in Steps 3–4.
- Worker message schema is implicit — formalised in Step 5.
- `_sanitiseRenderParams` clamps values that ParamStore will handle — deleted in Step 2.

---

## Commit Convention (this refactor)

`refactor(psi): <what changed> — step N`

One logical change per commit. No multi-concern commits.
