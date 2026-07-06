class FormatUtils {
  static formatSigned(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    if (n === 0) return "+0.000";
    const abs = Math.abs(n);
    if (abs >= 1e3 || abs < 1e-3) {
      const [mantissa, exponent] = n.toExponential(2).split("e");
      return `${n >= 0 ? "+" : ""}${mantissa}e^${Number(exponent)}`;
    }
    return `${n >= 0 ? "+" : ""}${n.toPrecision(3)}`;
  }

  static formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return FormatUtils.formatSigned(n * 100);
  }

  static formatInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return String(Math.round(n));
  }

  static formatFixed(value, digits = 3) {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    if (abs > 0 && abs < Math.pow(10, -digits)) {
      const [mantissa, exponent] = n.toExponential(2).split("e");
      return `${mantissa}e^${Number(exponent)}`;
    }
    return n.toFixed(digits);
  }
}

export { FormatUtils };
