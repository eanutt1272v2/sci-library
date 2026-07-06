class RLECodec {
  static encodeByteArray(values) {
    if (!values || values.length === 0) return "!";

    let line = "";
    let runCount = 0;
    let runToken = "";

    for (let i = 0; i < values.length; i++) {
      const byte = Math.max(0, Math.min(255, Number(values[i]) | 0));
      const token = this._byteToToken(byte);

      if (runCount === 0) {
        runToken = token;
        runCount = 1;
      } else if (token === runToken) {
        runCount++;
      } else {
        line += this._formatRun(runCount, runToken);
        runToken = token;
        runCount = 1;
      }
    }

    if (runCount > 0) {
      line += this._formatRun(runCount, runToken);
    }

    return `${line}!`;
  }

  static decodeByteArray(rleString, length) {
    const outLength = Number(length) > 0 ? Number(length) : 0;
    const decoded = new Uint8Array(outLength);

    if (!rleString || outLength <= 0) {
      return decoded;
    }

    const input = this._normaliseInput(rleString);
    let outIndex = 0;

    for (let i = 0; i < input.length && outIndex < outLength; ) {
      let count = 0;
      while (i < input.length) {
        const code = input.charCodeAt(i);
        if (code >= 48 && code <= 57) {
          count = count * 10 + (code - 48);
          i++;
          continue;
        }
        break;
      }

      if (i >= input.length) break;
      const ch = input[i];

      if (ch === "!") break;

      if (ch === "$") {
        i++;
        continue;
      }

      const tokenInfo = this._readToken(input, i);
      if (!tokenInfo) {
        i++;
        continue;
      }

      const runCount = count > 0 ? count : 1;
      const value = this._tokenToByte(tokenInfo.token);

      for (let k = 0; k < runCount && outIndex < outLength; k++) {
        decoded[outIndex++] = value;
      }

      i = tokenInfo.nextIndex;
    }

    return decoded;
  }

  static encodeFloat32Array(values) {
    const source =
      values instanceof Float32Array ? values : Float32Array.from(values || []);
    const bytes = new Uint8Array(source.byteLength);
    bytes.set(
      new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
    );
    return this.encodeByteArray(bytes);
  }

  static decodeFloat32Array(rleString, length) {
    const outLength = Number(length) > 0 ? Number(length) : 0;
    const bytes = this.decodeByteArray(rleString, outLength * 4);
    return new Float32Array(bytes.buffer);
  }

  static _normaliseInput(rleString) {
    return String(rleString || "")
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed.startsWith("#")) return false;
        if (/^x\s*=/.test(trimmed)) return false;
        return true;
      })
      .join("")
      .replace(/\s+/g, "");
  }

  static _readToken(input, index) {
    const ch = input[index];
    if (ch === "." || ch === "b" || ch === "o" || (ch >= "A" && ch <= "X")) {
      return { token: ch, nextIndex: index + 1 };
    }

    if (ch >= "p" && ch <= "y" && index + 1 < input.length) {
      const next = input[index + 1];
      if (next >= "A" && next <= "X") {
        return { token: ch + next, nextIndex: index + 2 };
      }
    }

    return null;
  }

  static _tokenToByte(token) {
    return this._decodeTokenToByte(token);
  }

  static _decodeTokenToByte(token) {
    if (token === "." || token === "b") return 0;
    if (token === "o") return 255;

    let byte = 0;
    if (token.length === 1 && token >= "A" && token <= "X") {
      byte = token.charCodeAt(0) - 65 + 1;
    } else if (token.length === 2) {
      byte = (token.charCodeAt(0) - 112) * 24 + (token.charCodeAt(1) - 65 + 25);
    }

    return Math.max(0, Math.min(255, byte));
  }

  static _byteToToken(byte) {
    if (byte <= 0) return ".";
    if (byte >= 255) return "o";
    if (byte < 25) return String.fromCharCode(65 + byte - 1);

    const offset = byte - 25;
    return (
      String.fromCharCode(112 + Math.floor(offset / 24)) +
      String.fromCharCode(65 + (offset % 24))
    );
  }

  static _formatRun(count, token) {
    return `${count > 1 ? count : ""}${token}`;
  }
}

export { RLECodec };
