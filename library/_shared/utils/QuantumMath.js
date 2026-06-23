(function (global) {
  "use strict";

  /**
   * Log-gamma function via the Lanczos approximation.
   * Accurate to double precision for z > 0. Uses the reflection
   * formula for z < 0.5 to extend the domain.
   *
   * @param {number} z
   * @returns {number} ln Γ(z)
   */
  function logGamma(z) {
    const coeffs = [
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7,
    ];

    if (z < 0.5) {
      return (
        Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
      );
    }

    let x = 0.99999999999980993;
    const tZ = z - 1;
    for (let i = 0; i < coeffs.length; i++) {
      x += coeffs[i] / (tZ + i + 1);
    }

    const t = tZ + coeffs.length - 0.5;
    return (
      0.5 * Math.log(2 * Math.PI) + (tZ + 0.5) * Math.log(t) - t + Math.log(x)
    );
  }

  /**
   * Generalised Laguerre polynomial L_k^(alpha)(x) via three-term recurrence.
   * Returns 1.0 for k <= 0. Returns 0.0 on overflow.
   *
   * @param {number} k      - Degree (non-negative integer)
   * @param {number} alpha  - Parameter (2l+1 for radial hydrogen wavefunctions)
   * @param {number} x      - Argument (rho = 2Zr / na_mu)
   * @returns {number}
   */
  function genLaguerre(k, alpha, x) {
    if (k <= 0) return 1.0;
    let L2 = 1.0;
    let L1 = 1.0 + alpha - x;
    let Lc = L1;
    for (let i = 2; i <= k; i++) {
      Lc = ((2 * i - 1 + alpha - x) * L1 - (i - 1 + alpha) * L2) / i;
      L2 = L1;
      L1 = Lc;
    }
    return Number.isFinite(Lc) ? Lc : 0.0;
  }

  /**
   * Associated Legendre polynomial P_l^|m|(x) via forward recurrence.
   * Uses the numerically stable form sqrt((1-x)(1+x)) to avoid
   * catastrophic cancellation near |x| = 1.
   *
   * @param {number} l    - Degree (non-negative integer)
   * @param {number} absM - Order |m| (0 <= absM <= l)
   * @param {number} x    - Argument (cos theta, -1 <= x <= 1)
   * @returns {number}
   */
  function assocLegendre(l, absM, x) {
    let pmm = 1.0;
    if (absM > 0) {
      const somx2 = Math.sqrt(Math.max(0, (1.0 - x) * (1.0 + x)));
      let fact = 1.0;
      for (let i = 1; i <= absM; i++) {
        pmm *= -fact * somx2;
        fact += 2.0;
      }
    }
    if (l === absM) return pmm;
    let pmmp1 = x * (2.0 * absM + 1.0) * pmm;
    if (l === absM + 1) return pmmp1;
    let pll = 0;
    for (let ll = absM + 2; ll <= l; ll++) {
      pll =
        (x * (2.0 * ll - 1.0) * pmmp1 - (ll + absM - 1.0) * pmm) /
        (ll - absM);
      pmm = pmmp1;
      pmmp1 = pll;
    }
    return Number.isFinite(pmmp1) ? pmmp1 : 0.0;
  }

  global.QuantumMath = Object.freeze({
    logGamma,
    genLaguerre,
    assocLegendre,
  });
})(typeof self !== "undefined" ? self : globalThis);
