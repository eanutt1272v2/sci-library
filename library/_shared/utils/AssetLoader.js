class AssetLoader {
  /**
   * Load the preferred UI font. Primary path is a WOFF2 via the framework-
   * independent FontFace API; it falls back to p5's `loadFont` on a TTF (for
   * WEBGL text, which needs a real p5.Font), and finally to the bare family
   * string. Returns whatever the caller can hand to `textFont` — a family
   * string or a p5.Font.
   *
   * @param {Object} opts
   * @param {string} [opts.family]
   * @param {string} [opts.woff2Path]
   * @param {string} [opts.ttfPath]
   * @param {Object} [opts.p] - p5 instance, for the TTF `loadFont` fallback.
   *   Passed explicitly so this file has no p5 global-mode dependency.
   * @returns {Promise<string|Object>}
   */
  static async loadPreferredFont({
    family = "Iosevka",
    woff2Path = "",
    ttfPath = "",
    p = null,
  } = {}) {
    const safeFamily = String(family || "Iosevka");

    const canUseFontFace =
      typeof window !== "undefined" &&
      typeof window.FontFace === "function" &&
      typeof document !== "undefined" &&
      !!document.fonts &&
      typeof document.fonts.add === "function";

    if (canUseFontFace && woff2Path) {
      try {
        if (
          typeof document.fonts.check === "function" &&
          document.fonts.check(`400 12px "${safeFamily}"`)
        ) {
          return safeFamily;
        }

        const face = new FontFace(
          safeFamily,
          `url("${woff2Path}") format("woff2")`,
          { style: "normal", weight: "400" },
        );

        const loadedFace = await face.load();
        document.fonts.add(loadedFace);

        if (typeof document.fonts.load === "function") {
          await document.fonts.load(`400 12px "${safeFamily}"`);
        }

        return safeFamily;
      } catch (error) {
        console.warn(
          `[AssetLoader] WOFF2 FontFace load failed for ${safeFamily}; falling back to TTF:`,
          error,
        );
      }
    }

    if (p && typeof p.loadFont === "function" && ttfPath) {
      try {
        return await p.loadFont(ttfPath);
      } catch (error) {
        console.warn(
          `[AssetLoader] TTF loadFont fallback failed for ${safeFamily}; using family string:`,
          error,
        );
      }
    }

    return safeFamily;
  }

  /**
   * Load and parse a same-origin JSON asset via `fetch`. No p5 dependency, so
   * this works identically whether p5 runs in global or instance mode.
   *
   * @param {string} path
   * @param {{label?: string}} [opts]
   * @returns {Promise<*>}
   */
  static async loadJSONAsset(path, { label = "JSON asset" } = {}) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading ${path}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`[AssetLoader] ${label} load failed:`, error);
      throw error;
    }
  }

  /**
   * Load a same-origin text asset (e.g. a shader source) via `fetch`.
   *
   * @param {string} path
   * @param {{label?: string}} [opts]
   * @returns {Promise<string>}
   */
  static async loadShaderSource(path, { label = "Shader source" } = {}) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} loading ${path}`);
      }
      return await response.text();
    } catch (error) {
      console.error(`[AssetLoader] ${label} load failed:`, error);
      throw error;
    }
  }
}
