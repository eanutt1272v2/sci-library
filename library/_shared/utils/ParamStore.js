/**
 * ParamStore — a generic, reusable parameter store engine.
 *
 * A ParamStore is the single source of truth for a set of named parameters. Each
 * parameter is described by a schema entry that fixes its type, default, bounds,
 * and (for enums) its valid option list. On the way in, `set()` coerces and clamps
 * every value against that schema so downstream consumers (GUI, worker, renderer)
 * can trust the stored value without re-validating it.
 *
 * Two features make it reusable across both apps rather than hand-rolled per app:
 *
 *  - **Relative bounds.** A `min`/`max` may reference another parameter's live
 *    value instead of a fixed number (e.g. quantum number `l` whose max is
 *    `n - 1`). Relative bounds are resolved against current state every time a
 *    value is set or a range is read, so a dependent range stays correct as its
 *    referent changes.
 *  - **Dynamic enum options.** An enum's valid option list can be supplied at
 *    construction (e.g. a colour-map list loaded from a runtime asset) rather than
 *    hardcoded in the schema.
 */

/**
 * @typedef {Object} RelativeBound
 * @property {string} key      - Name of another schema parameter to resolve against.
 * @property {number} [offset] - Resolved as `otherParam.value + offset`.
 * @property {1|-1}   [sign]   - Resolved as `sign * otherParam.value`.
 */

/**
 * @typedef {Object} SchemaEntry
 * @property {*}      default   - Seed value; assumed already valid for the type.
 * @property {'int'|'float'|'bool'|'enum'|'color'} type
 * @property {number|RelativeBound} [min]  - Lower bound (int/float only).
 * @property {number|RelativeBound} [max]  - Upper bound (int/float only).
 * @property {number} [step]    - GUI step hint; stored, not enforced here.
 * @property {string} [label]   - GUI label hint; stored, not used here.
 * @property {string[]} [options] - Valid values for `type: 'enum'`.
 */

class ParamStore {
  /**
   * @param {Object<string, SchemaEntry>} schema - Params keyed by (possibly
   *   dotted) name; see {@link SchemaEntry}. Dotted keys such as `viewCentre.x`
   *   are stored flat and re-exposed as nested objects via {@link asObject}.
   * @param {Object} [options]
   * @param {Object<string, string[]>} [options.dynamicOptions] - Per-key enum
   *   option lists supplied at runtime; each overrides that key's static
   *   `schema[key].options`.
   */
  constructor(schema, options = {}) {
    if (!schema || typeof schema !== "object") {
      throw new TypeError("ParamStore: schema must be an object");
    }

    this._schema = schema;
    this._dynamicOptions = options.dynamicOptions || {};
    this._values = {};

    for (const key of Object.keys(schema)) {
      this._values[key] = schema[key].default;
    }
  }

  /**
   * Throw if `key` is not a declared parameter. Surfacing an unknown key as a
   * hard error is deliberate: a soft fallback would hide a typo or a stale
   * reference instead of exposing it.
   *
   * @param {string} key
   * @returns {SchemaEntry}
   */
  _assertKnown(key) {
    const entry = this._schema[key];
    if (!entry) {
      throw new RangeError(`ParamStore: unknown parameter "${key}"`);
    }
    return entry;
  }

  /**
   * Return the current value of `key`.
   *
   * @param {string} key
   * @returns {*} The stored value.
   * @throws {RangeError} If `key` is not a declared parameter.
   */
  get(key) {
    this._assertKnown(key);
    return this._values[key];
  }

  /**
   * Coerce `value` to `key`'s type, clamp it against the (possibly relative)
   * bounds resolved from current state, and store the result.
   *
   * Coercion by type: int rounds then clamps; float clamps; bool is `Boolean()`;
   * enum must be in the resolved option list or reverts to the default; color
   * expects `{r, g, b}` with each channel clamped to 0-255.
   *
   * @param {string} key
   * @param {*} value
   * @returns {*} The stored (coerced/clamped) value.
   * @throws {RangeError} If `key` is not a declared parameter.
   */
  set(key, value) {
    const entry = this._assertKnown(key);
    const coerced = this._coerce(entry, key, value);
    this._values[key] = coerced;
    return coerced;
  }

  /**
   * Return the currently-effective bounds for `key`, resolving any relative
   * bounds against current state. GUI code calls this at binding-construction
   * time instead of hardcoding numeric literals.
   *
   * @param {string} key
   * @returns {{min: (number|undefined), max: (number|undefined)}} Resolved
   *   bounds; a side is `undefined` when the schema declares no bound for it.
   * @throws {RangeError} If `key` is not a declared parameter.
   */
  getRange(key) {
    const entry = this._assertKnown(key);
    return {
      min: this._resolveBound(entry.min),
      max: this._resolveBound(entry.max),
    };
  }

  /**
   * Return a frozen shallow copy of every current value — a single read of "all
   * params right now", e.g. to pass into a worker message.
   *
   * @returns {Readonly<Object<string, *>>}
   */
  snapshot() {
    const out = {};
    for (const key of Object.keys(this._values)) {
      out[key] = this._values[key];
    }
    return Object.freeze(out);
  }

  /**
   * Build a live-binding view over a group of dotted keys sharing a prefix, so
   * consumer code (and Tweakpane binding targets) can read/write
   * `obj.x` where the store holds `prefix.x`. Reads and writes pass straight
   * through to {@link get}/{@link set}, so the object always reflects — and
   * mutates — live store state.
   *
   * @param {string} prefix - e.g. `'viewCentre'`.
   * @param {string[]} keys - Leaf names, e.g. `['x', 'y', 'z']`.
   * @returns {Object} An object with a live getter/setter per leaf key.
   */
  asObject(prefix, keys) {
    const store = this;
    const view = {};
    for (const leaf of keys) {
      const full = `${prefix}.${leaf}`;
      Object.defineProperty(view, leaf, {
        enumerable: true,
        configurable: true,
        get() {
          return store.get(full);
        },
        set(value) {
          store.set(full, value);
        },
      });
    }
    return view;
  }

  /**
   * Resolve the valid option list for an enum key: a runtime `dynamicOptions`
   * list for the key overrides the schema's static `options`.
   *
   * @param {string} key
   * @param {SchemaEntry} entry
   * @returns {string[]}
   */
  _optionsFor(key, entry) {
    if (Array.isArray(this._dynamicOptions[key])) {
      return this._dynamicOptions[key];
    }
    return Array.isArray(entry.options) ? entry.options : [];
  }

  /**
   * Resolve a bound spec to a concrete number (or `undefined` when absent). A
   * plain number is returned as-is; a {@link RelativeBound} is resolved against
   * the referenced parameter's current value.
   *
   * @param {number|RelativeBound|undefined} bound
   * @returns {number|undefined}
   * @throws {RangeError} If `bound` is a malformed object or references an
   *   unknown parameter.
   */
  _resolveBound(bound) {
    if (bound === undefined || bound === null) {
      return undefined;
    }
    if (typeof bound === "number") {
      return bound;
    }
    if (typeof bound === "object") {
      const reference = this.get(bound.key);
      if (typeof bound.offset === "number") {
        return reference + bound.offset;
      }
      if (typeof bound.sign === "number") {
        return bound.sign * reference;
      }
    }
    throw new RangeError(
      `ParamStore: invalid bound specification: ${JSON.stringify(bound)}`,
    );
  }

  /**
   * Clamp a finite number to `key`'s currently-resolved bounds. An unspecified
   * side imposes no limit.
   *
   * @param {SchemaEntry} entry
   * @param {number} value
   * @returns {number}
   */
  _clampToBounds(entry, value) {
    const min = this._resolveBound(entry.min);
    const max = this._resolveBound(entry.max);
    let result = value;
    if (typeof min === "number" && result < min) {
      result = min;
    }
    if (typeof max === "number" && result > max) {
      result = max;
    }
    return result;
  }

  /**
   * Coerce and (for numeric types) clamp a raw value per its schema entry's
   * type. See {@link set} for the per-type rules.
   *
   * @param {SchemaEntry} entry
   * @param {string} key
   * @param {*} value
   * @returns {*}
   */
  _coerce(entry, key, value) {
    switch (entry.type) {
      case "int": {
        const numeric = Math.round(ParamStore._toFinite(value, entry.default));
        return this._clampToBounds(entry, numeric);
      }
      case "float": {
        const numeric = ParamStore._toFinite(value, entry.default);
        return this._clampToBounds(entry, numeric);
      }
      case "bool":
        return Boolean(value);
      case "enum": {
        const options = this._optionsFor(key, entry);
        return options.includes(value) ? value : entry.default;
      }
      case "color":
        return ParamStore._coerceColor(value, entry.default);
      default:
        throw new RangeError(
          `ParamStore: unknown type "${entry.type}" for "${key}"`,
        );
    }
  }

  /**
   * Coerce a value to a finite number, falling back when it is not finite.
   *
   * @param {*} value
   * @param {number} fallback
   * @returns {number}
   */
  static _toFinite(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  /**
   * Coerce a colour to `{r, g, b}` with each channel rounded and clamped to the
   * 0-255 integer range. A non-object input reverts to `fallback`.
   *
   * @param {*} value
   * @param {{r: number, g: number, b: number}} fallback
   * @returns {{r: number, g: number, b: number}}
   */
  static _coerceColor(value, fallback) {
    const source = value && typeof value === "object" ? value : fallback;
    return {
      r: ParamStore._channel(source.r),
      g: ParamStore._channel(source.g),
      b: ParamStore._channel(source.b),
    };
  }

  /**
   * Round and clamp a single colour channel to the 0-255 integer range.
   *
   * @param {*} value
   * @returns {number}
   */
  static _channel(value) {
    const numeric = Math.round(ParamStore._toFinite(value, 0));
    if (numeric < 0) return 0;
    if (numeric > 255) return 255;
    return numeric;
  }
}

export { ParamStore };
