# Architecture

## Purpose and scope

This document describes the intended architecture of the two p5.js sketches in this
repo — `library/Psi` and `library/Fluvia` — and the shared code in `library/_shared`.
It is the target state the Stage 2+ rearchitecture works toward, and the set of rules
new code (in either app) is expected to follow from Stage 1 onward.

It is **not** a description of the current codebase in every detail. Where the current
code violates a rule below, that's named explicitly as a known, tracked divergence
rather than glossed over — see "Known present-day divergences" in each section.

## System overview

Both apps follow the same shape:

```
index.html loads script tags (classic + a handful of ES modules, see "Module
system" below) → AppCore is constructed → AppCore owns:
  - the parameter store (defaults, sanitisation)
  - a Worker (PsiWorker.js / FluviaWorker.js) that does the heavy numeric work
  - GUI (Tweakpane panel)
  - InputHandler (keyboard/pointer)
  - Renderer (p5 draw loop)
  - Media (import/export)
```

## Unidirectional data flow

The intended flow, identical in both apps:

```
GUI / InputHandler / Media (user input)
        │
        ▼
   AppCore.store  ──(sanitise/clamp on the way in)
        │
        ├──postMessage──▶ Worker (compute) ──postMessage──▶ AppCore._onWorkerMessage
        │                                                            │
        ▼                                                            ▼
   Renderer.draw()  ◀──reads store.get()───────────────────  store.set(result)
        │
        ▼
   GUI (read-only reflection of store state, e.g. stat readouts)
```

The store is the single place state changes. Nothing downstream of it (Renderer,
GUI readouts, Media export) should mutate it directly or hold a mutable reference
into it — they read a value, use it, done. Nothing upstream of the worker boundary
(GUI, InputHandler) should assume the worker's result before it arrives; the worker
is asynchronous by construction (`postMessage`/`onmessage`), and `AppCore` is the
only module allowed to bridge that asynchrony back into the store.

## Module boundary rules

- **No upward back-references.** A module may be given a narrow, explicit
  dependency (a callback, a store handle, specific data) by its owner. It must not
  hold a reference to its owner and reach back up through it to get other data.
- **Known present-day divergence:** `Renderer` in both apps takes the entire
  `appcore` instance in its constructor and reads `this.appcore.params`,
  `this.appcore.statistics`, `this.appcore.analyser`, `this.appcore.metadata`, etc.
  directly, on demand (`Psi/modules/render/Renderer.js:14-437`,
  `Fluvia/modules/render/Renderer.js:2-5`). This is exactly the upward
  back-reference this rule forbids — `Renderer` can reach anything `AppCore` owns,
  not just what it needs to draw. Closing this (passing `Renderer` only the
  specific store slices/methods it actually uses) is Stage 2+ work; it is not
  touched in Stage 1.
- Workers are the one deliberate exception to "no back-references" in the other
  direction: `AppCore` owns the worker and only ever talks to it through
  `postMessage`/`onmessage`, never a direct object reference. That boundary is
  correct as-is and should not change.

## Module system & interop

**End state (Stage 2+):** every authored file is a real ES module, importing
exactly what it uses. `<script type="module">` throughout; no implicit globals.

**Stage 1 (current):** two different situations, requiring two different
treatments, both used in this repo today:

1. **Files loaded via `importScripts()` inside a Worker**
   (`WorkerSanitisers.js`, `QMath.js`) — `importScripts()` cannot parse a literal
   `export` statement (`SyntaxError`). These already expose their API via
   `global.X = Object.freeze({...})` against
   `typeof self !== "undefined" ? self : globalThis`, which works unchanged in
   both the worker and in Node's test runner. **These two files get no `export`
   until the workers themselves are rewritten as ES modules** (Stage 2+, when
   `importScripts` is replaced with `import` inside a module worker).

2. **Files loaded via classic `<script>` tags into the main-thread global scope**
   (`Quaternion.js`, `RLECodec.js`, `FormatUtils.js`, `ColourMapLUT.js`) — these
   were bare `class X {}` declarations with no explicit global assignment; they
   only worked because classic scripts share an implicit global lexical scope.
   That trick breaks the moment a file becomes a module (module scope is
   private). Stage 1 adds, after the class body, a **temporary compatibility
   bridge**:
   ```js
   globalThis.X = X;
   export { X };
   ```
   and switches only that file's `<script>` tag to `type="module"` in both
   `index.html`s. This is intentionally a dual-mode file: it works as a classic
   global (for consumers not yet migrated) *and* as a real module (for tests,
   and for future consumers).

   **Removal condition:** once every consumer of `X` in both apps imports it
   directly via `import { X } from ...` (i.e. once `AppCore`/`GUI`/`Renderer`/etc.
   are themselves ES modules), delete the `globalThis.X = X;` bridge line and
   leave only the `export`. Tracking which files still rely on the implicit
   global is Stage 2+ scope.

Both `index.html` files already had one `<script type="module">` block before
Stage 1 — the Tweakpane import (`import { Pane } from ".../tweakpane.min.js"`,
`window.Tweakpane = { Pane }`) — which is why adding four more module script tags
in the same position is a safe, precedented pattern rather than a novel one.

## p5.js integration

p5.js is kept (not removed) and will be migrated to **v2.3 ESM instance mode**
using a **locally vendored** `p5.esm.min.js` (not a CDN import) — matching this
repo's existing practice of vendoring all third-party code locally (`p5.min.js`,
`tweakpane.min.js` today) rather than depending on a CDN at runtime, which is also
consistent with the CSP already in place (Caddyfile `script-src` does not need a
CDN origin added). This migration is Stage 2+ work; Stage 1 does not touch p5.js
or its loading in either app.

## Parameter schema as single source of truth

**The problem this section exists to prevent:** parameter bounds are currently
declared independently in 3-4 places per parameter — the store's defaults, the GUI
slider config, `InputHandler`'s keyboard-nudge clamp, and the worker's own
defensive clamp — and they have already drifted out of sync. Confirmed, present-day
examples:

- Fluvia `entrainment`: GUI slider `min: 0, max: 10`
  (`Fluvia/modules/ui/GUI.js:229`) vs. `AppCore`'s sanitiser `0, 20`
  (`Fluvia/modules/core/AppCore.js:191`) vs. the worker's own clamp `0, 50`
  (`Fluvia/modules/worker/FluviaWorker.js:239`). Three different ranges for one
  parameter.
- Psi `resolution`: schema/store allows 100-800, but the GUI slider and
  `InputHandler` both independently clamp to 64-512, and `PsiWorker.js` clamps to
  64-512 too — a user can never reach below 100 despite the slider showing 64, and
  the schema's 800 ceiling is unreachable fiction.
- Psi `n` (quantum number): GUI slider allows up to 12
  (`AppCore.QUANTUM_LIMITS.maxN`), but the schema caps at 8 — a value set above 8
  via the GUI silently snaps back.

**The Stage 2+ target:** one schema per app (or one shared schema shape, given
both apps' parameters are conceptually the same kind of thing), consumed by the
store, the GUI, `InputHandler`, and the worker — so a range only ever exists in one
place. Stage 1 does not consolidate this; it locks in current behavior (including
the above mismatches) with regression tests, so Stage 2 can fix it against a
green test suite rather than blind.

## Error-handling convention

Plain `console.*` (`console.info`/`warn`/`error`/`debug`) inside `try`/`catch`,
at the point where an error is actually handled — no custom logger abstraction,
no log levels beyond what `console` already gives you.

`AppDiagnostics.js` currently wraps `console.*` in a `createLogger`/`resolveLogger`
indirection that adds no behavior beyond tagging messages with a label. That
wrapper is removed in Stage 2+. Two behaviors in `AppDiagnostics.js` are **not**
just console wrapping and are extracted as small, independent, purpose-named
utilities rather than deleted:

- **Frame-friendly task scheduling** (`scheduleFrameFriendlyTask`,
  `scheduleFrameFriendlySequence`) — `requestIdleCallback`-based chunking, used to
  avoid blocking a draw frame. Real, non-trivial scheduling logic.
- **Worker-message safety helpers** (`safePostMessage`, `consumeWorkerError`) —
  the `try`/`catch` wrapper around `postMessage` and the shared shape for reading
  a worker's reported error back on the main thread. Real, non-trivial contract
  logic tied to the worker boundary (see below), not logging.

Everything else in `AppDiagnostics.js` (the logger tagging, `isDebugEnabled`,
`installGlobalErrorHandlers`) is exactly the kind of indirection this convention
removes.

## Worker communication contract

Both workers (`PsiWorker.js`, `FluviaWorker.js`) speak the same shape of protocol:

- Main → worker: a plain message object; the worker sanitises every field itself
  on receipt (via `WorkerSanitisers.clamp`/`toFiniteNumber`/`toInteger`) rather
  than trusting the main thread's own sanitisation — this is deliberate defense
  in depth, not duplication to remove.
- Worker → main: `self.postMessage(payload)` where `payload` includes a
  `requestId` that round-trips from the originating request
  (`PsiWorker.js:137,548`), so `AppCore._onWorkerMessage` can match a response to
  its request even if messages arrive out of order.
- Typed-array results are transferred (not copied) for GC/perf reasons; `AppCore`
  validates `ArrayBuffer` type and exact byte length before touching a transferred
  buffer.
- On failure, the worker reports the error back via a message (caught and
  reported through `AppDiagnostics.consumeWorkerError`/`safePostMessage`) rather
  than throwing across the boundary uncaught.

This contract does not change in Stage 1 or in the Stage 2+ module rewrite — only
the module system the worker's own code is written in changes (`importScripts` →
`import`, once the worker itself becomes a module worker).

## Naming & file organization

- One class per file; filename matches the class name (`Quaternion.js` exports
  `Quaternion`, etc.).
- `library/<App>/modules/<category>/<File>.js` — category folders
  (`math`, `model`, `render`, `input`, `ui`, `worker`, `analysis`, `media`, `core`)
  are the same names in both apps; `library/_shared/utils` holds anything used by
  both apps unchanged.
- Tests mirror this exact structure under a top-level `tests/` directory (see
  "Testing strategy" below) — same relative path, `.test.js` suffix.

## Cross-app consistency rule

Psi and Fluvia are two independent sketches sharing an architecture, not a shared
codebase with copy-pasted apps — but where they implement the same *kind* of
thing, they should do it the same way. Known, confirmed divergences to close as
Stage 2+ work (not fixed in Stage 1):

- **Parameter range mismatches** — see "Parameter schema as single source of
  truth" above.
- **Quote style in `index.html`**: Psi's module script block uses double quotes
  throughout (`import { Pane } from "../_shared/lib/tweakpane.min.js"`,
  `Psi/index.html:14`); Fluvia's equivalent block uses single quotes
  (`Fluvia/index.html:10`). The rest of each file's HTML attributes follow the
  same per-app pattern (Psi self-closes void elements, e.g. `<meta ... />`;
  Fluvia does not, e.g. `<meta ... >`). Pick one convention repo-wide — see
  CODESTYLE.md's recommendation to adopt Prettier, which would settle this
  automatically.
- **`Media.js:90`'s broken method reference** (`Psi`) — calls
  `this.appcore._sanitisePhysicalParams()`, a method that no longer exists;
  `AppCore`'s actual method (after a rename) is `_sanitiseLegacyParams`. Currently
  silently no-ops behind a `typeof === "function"` guard. Confirmed bug, not fixed
  in Stage 1 (behavior change).
- **`Terrain.generateInChunks()`** (`Fluvia`) — a fully-built async chunked
  terrain generator is never called; all regen call sites use the synchronous
  `generate()` instead. Either wire it in or delete it — Stage 2+ decision.

## Testing strategy

Tests live in a **top-level `tests/` directory**, mirroring `library/`'s internal
structure, rather than colocated next to the source files. This is not a stylistic
choice: `library/` is copied verbatim into the production Docker image and served
with directory listing on (`Dockerfile`: `COPY library /srv`; `Caddyfile`: `root *
/srv` + `file_server browse`). Anything under `library/` is publicly servable and
browsable. Test files must never end up there.

`node --test` (Node's built-in test runner, zero new dependencies) discovers test
files via a glob pattern (`tests/**/*.test.js`); see `package.json`'s `scripts`.
Each module under test is either imported directly (the four Stage 1
dual-mode-bridge files) or imported for its side effect of assigning onto
`globalThis` (`QMath.js`, `WorkerSanitisers.js` — matching how the workers
actually load them via `importScripts`).

## Explicit non-goals (Stage 1)

This document describes the target architecture; the following are **not**
implemented by Stage 1 and are tracked as Stage 2+ backlog:

- Rewriting `AppCore`/`GUI`/`InputHandler`/`Renderer`/`Media`/`Worker` as real ES
  modules in either app.
- The p5 ESM instance-mode migration.
- Consolidating the duplicated parameter schema/clamp logic.
- Stripping `AppDiagnostics.js` down to the convention above.
- Fixing the confirmed bugs listed under "Cross-app consistency rule" and
  "Parameter schema as single source of truth".
- `ColourMapLUT.js`'s implicit, untested dependency on the p5-provided global
  `constrain()` (confirmed via grep: no local definition anywhere in authored
  code). Stage 1's test for this file stubs `globalThis.constrain` locally; the
  dependency itself is not addressed until Stage 2+.
