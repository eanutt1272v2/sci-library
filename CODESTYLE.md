# Code Style

## Enforcement

Review-enforced, not tool-enforced — there is no linter or formatter configured
yet. See "Formatting" below for a proposed Stage 1.5 add-on that would change
this. Until then, treat this document as the checklist a reviewer works from.

## File structure template

One class per file. A file looks like:

```js
class ThingName {
  // static config/data first, if any (see ColourMapLUT.GREYSCALE for precedent)

  constructor(...) { ... }

  methodName(...) { ... }
}

// Stage 1 compatibility bridge — see ARCHITECTURE.md's "Module system & interop".
// Only present on files still consumed as classic-script globals; remove once
// all consumers import directly.
globalThis.ThingName = ThingName;

export { ThingName };
```

Files consumed only via `importScripts()` inside a worker (`QMath.js`,
`WorkerSanitisers.js`) instead follow the existing IIFE + `global.X =
Object.freeze({...})` shape — see ARCHITECTURE.md. Do not add `export` to those
two files.

## Naming conventions

- Classes: `PascalCase`, filename matches exactly (`RLECodec.js` → `RLECodec`).
- Methods/functions/variables: `camelCase`.
- Private-by-convention methods (not called from outside the class): leading
  underscore, e.g. `_sanitiseLegacyParams`, `_onWorkerMessage`.
- Constants that are truly fixed data (lookup tables, coefficient arrays): `static`
  class fields in `UPPER_SNAKE_CASE` when they're a named constant
  (`ColourMapLUT.GREYSCALE`, `AppCore.QUANTUM_LIMITS`), plain `camelCase` `const`
  when they're local/derived.

## JSDoc minimum bar

Every exported function that isn't self-explanatory from its name and a glance at
its body gets a JSDoc block with `@param`/`@returns` and a one-to-three-line
description of *what it computes and why*, not a restatement of the signature.
`QMath.js`'s `logGamma` is the reference example already in the codebase:

```js
/**
 * Log-gamma function via the Lanczos approximation.
 * Accurate to double precision for z > 0. Uses the reflection
 * formula for z < 0.5 to extend the domain.
 *
 * @param {number} z
 * @returns {number} ln Γ(z)
 */
function logGamma(z) { ... }
```

Trivial one-line getters/setters and obvious pass-through methods don't need
this. If you're unsure whether a function is "obvious enough" to skip the block,
it isn't — write it.

## Error handling style

Plain `console.*` inside `try`/`catch`, at the point where the error is actually
handled. No custom logger wrapper, no log-level abstraction beyond what
`console.info`/`warn`/`error`/`debug` already give you. See ARCHITECTURE.md's
"Error-handling convention" for the two named exceptions
(frame-friendly scheduling, worker-message safety helpers) that are real logic,
not logging, and are kept as their own small utilities rather than folded into
this convention or deleted.

## Formatting

No formatter is configured yet, which is how two concrete inconsistencies have
already crept in between the two apps:

- `library/Psi/index.html`'s inline module script uses double quotes
  (`import { Pane } from "../_shared/lib/tweakpane.min.js"`); the same line in
  `library/Fluvia/index.html` uses single quotes. Psi self-closes void HTML
  elements (`<meta ... />`); Fluvia does not (`<meta ... >`).

Pick one style and apply it to both files by hand until a formatter is in place.
**Recommendation:** adopt Prettier as a low-risk Stage 1.5 add-on — it has an
HTML plugin, needs no config to start (its defaults are reasonable and
opinionated, which is the point), and would make this class of inconsistency
impossible to introduce silently in review. Not done as part of Stage 1 itself,
since it's a tooling addition, not part of the safety net this stage is
building.

## Module import/export style

- **Named exports only.** `export { ThingName };` at the bottom of the file, not
  `export default`. This matches the existing precedent
  (`window.Tweakpane = { Pane }` from a named import) and keeps renames/refactors
  traceable via plain-text grep, which a default export defeats.
- Import only what you use: `import { Quaternion } from "..."`, not a namespace
  import, even though nothing in this codebase needs tree-shaking today — it's
  what makes "who uses `X`" answerable by grep.

## Test file conventions

- One test file per source file, same relative path, under a top-level `tests/`
  directory that mirrors `library/`'s structure (not colocated — see
  ARCHITECTURE.md's "Testing strategy" for why: `library/` ships verbatim to
  production with directory listing on).
- `import { test, describe } from "node:test"; import assert from
  "node:assert/strict";` at the top of every test file.
- Group related tests under a `describe` block named after the function/method
  under test (`describe("QMath.logGamma", ...)`), not the file.
- A regression test that locks in a *known, tracked bug* (not yet fixed, per
  ARCHITECTURE.md's Stage 1/Stage 2+ split) must say so in both the test name and
  an inline comment — see `FormatUtils.test.js`'s `formatFixed` tests for the
  pattern: name the current behavior, then a comment explaining it's a known bug
  deferred to the Stage 2 backlog, not the intended contract.
- Prefer asserting exact values over "just doesn't throw" where a known-correct
  value exists (closed-form results, identities); reserve fuzz-style/garbage-input
  tests for functions whose contract really is "never crash, stay in bounds"
  (e.g. `RLECodec`'s decode-side regression tests).

## Anti-patterns to avoid

- **Duplicated clamp/range logic.** The exact bug this project is currently
  living with (Fluvia's `entrainment` has three different ranges across GUI,
  `AppCore`, and the worker — see ARCHITECTURE.md's "Parameter schema as single
  source of truth"). If you find yourself writing a second copy of a bound that
  already exists elsewhere, that's the signal to consolidate, not duplicate.
- **Upward back-references.** A module holding a reference to its owner and
  reaching back through it for unrelated data (`Renderer.appcore` — see
  ARCHITECTURE.md's "Module boundary rules"). Pass the specific thing a module
  needs; don't pass it the whole owner "to be safe."
- **Dead code left behind by a rename.** `Psi/modules/media/Media.js:90` calls
  `this.appcore._sanitisePhysicalParams()`, a method that was renamed to
  `_sanitiseLegacyParams` elsewhere and never updated at this call site; a
  `typeof === "function"` guard means it silently no-ops instead of erroring.
  When you rename a method, grep for every caller before you consider the rename
  done — a guard that swallows the failure is worse than the error would have
  been, because it hides the break instead of surfacing it.
