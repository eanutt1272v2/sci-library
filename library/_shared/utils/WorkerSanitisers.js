// Import-only as of the Stage A rearchitecture: this file now uses a real ES
// `export` instead of the previous `global.WorkerSanitisers = ...` assignment.
// A classic-script `importScripts('.../WorkerSanitisers.js')` can no longer parse
// it (the `export` is a SyntaxError). PsiWorker.js / FluviaWorker.js must be
// converted to `{ type: 'module' }` workers and `import` this instead — that
// conversion is Stage B's job.

/**
 * Clamp a value into an inclusive numeric range. NaN passes through unclamped,
 * since every comparison against NaN is false — callers that must reject NaN
 * should coerce first via {@link toFiniteNumber}.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Coerce a value to a finite number, returning `fallback` when the coercion is
 * not finite (NaN, ±Infinity). Note `Number(null)` is 0, not the fallback.
 *
 * @param {*} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Coerce a value to an integer within `[min, max]`: apply the finite fallback,
 * round to the nearest integer, then clamp.
 *
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function toInteger(value, fallback, min, max) {
  const numeric = Math.round(toFiniteNumber(value, fallback));
  return clamp(numeric, min, max);
}

const WorkerSanitisers = Object.freeze({
  clamp,
  toFiniteNumber,
  toInteger,
});

export { WorkerSanitisers };
