const COLOUR_MAP_OPTIONS = [
  'viridis', 'plasma', 'inferno', 'magma', 'cividis',
  'hot', 'cool', 'greys', 'blues', 'reds',
  'rainbow', 'jet', 'turbo',
];

export const PSI_SCHEMA = {
  // Quantum numbers
  n:                 { default: 3,         min: 1,    max: 8,    type: 'int',   label: 'n',                        step: 1 },
  l:                 { default: 1,         min: 0,    max: 7,    type: 'int',   label: 'l',                        step: 1 },
  m:                 { default: 0,         min: -7,   max: 7,    type: 'int',   label: 'm',                        step: 1 },
  // Computation
  resolution:        { default: 400,       min: 100,  max: 800,  type: 'int',   label: 'Resolution',               step: 10 },
  gridScale:         { default: 1.0,       min: 0.5,  max: 3.0,  type: 'float', label: 'Grid Scale',               step: 0.1 },
  // Tone mapping
  logAlpha:          { default: 200,       min: 1,    max: 2000, type: 'float', label: 'Log-\u03B3 Alpha \u03B1', step: 10,  keybind: ['[', ']'] },
  // Colour
  colourMap:         { default: 'viridis',                       type: 'enum',  label: 'Colour Map',               options: COLOUR_MAP_OPTIONS },
  colourReverse:     { default: false,                           type: 'bool',  label: 'Reverse Colour Map' },
  // Rendering flags
  renderOverlay:     { default: true,                            type: 'bool',  label: 'Statistics Overlay' },
  renderNodeOverlay: { default: false,                           type: 'bool',  label: 'Node Overlay' },
  showAxes:          { default: false,                           type: 'bool',  label: 'Show Axes' },
  // Export / media
  exportResolution:  { default: 1024,      min: 256,  max: 4096, type: 'int',   label: 'Export Resolution',        step: 128 },
};

export class ParamStore {
  constructor(schema) {
    this._schema    = schema;
    this._state     = {};
    this._listeners = {};

    for (const [key, def] of Object.entries(schema)) {
      this._state[key] = def.default;
    }
  }

  get schema() {
    return this._schema;
  }

  get(key) {
    if (!(key in this._state)) throw new RangeError(`ParamStore: unknown key "${key}"`);
    return this._state[key];
  }

  set(key, value) {
    if (!(key in this._schema)) throw new RangeError(`ParamStore: unknown key "${key}"`);
    const def     = this._schema[key];
    const coerced = this._coerce(def, value);
    const prev    = this._state[key];
    if (coerced === prev) return;
    this._state[key] = coerced;
    this._emit(key, coerced, prev);
  }

  snapshot() {
    return Object.freeze({ ...this._state });
  }

  onChange(key, fn) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(fn);
    return () => this._off(key, fn);
  }

  _off(key, fn) {
    if (!this._listeners[key]) return;
    this._listeners[key] = this._listeners[key].filter(f => f !== fn);
  }

  _emit(key, next, prev) {
    (this._listeners[key] || []).forEach(fn => fn(next, prev));
  }

  _coerce(def, value) {
    switch (def.type) {
      case 'int': {
        let v = Math.round(Number(value));
        if (isNaN(v)) v = def.default;
        if (def.min !== undefined) v = Math.max(def.min, v);
        if (def.max !== undefined) v = Math.min(def.max, v);
        return v;
      }
      case 'float': {
        let v = Number(value);
        if (isNaN(v)) v = def.default;
        if (def.min !== undefined) v = Math.max(def.min, v);
        if (def.max !== undefined) v = Math.min(def.max, v);
        return v;
      }
      case 'bool':
        return Boolean(value);
      case 'enum':
        return def.options.includes(value) ? value : def.default;
      default:
        return value;
    }
  }
}
