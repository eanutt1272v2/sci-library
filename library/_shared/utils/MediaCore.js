class MediaCore {
  constructor(appcore, logTag) {
    this.appcore = appcore;
    this.logTag = logTag;
    const loggerTag = String(logTag || "Media")
      .replace(/\]\[/g, ":")
      .replace(/[\[\]]/g, "")
      .trim();
    this._diagnosticsLogger = {
      info: (...args) => console.info(`[${loggerTag || "Media"}]`, ...args),
      warn: (...args) => console.warn(`[${loggerTag || "Media"}]`, ...args),
      error: (...args) => console.error(`[${loggerTag || "Media"}]`, ...args),
      debug: (...args) => console.debug(`[${loggerTag || "Media"}]`, ...args),
    };
    this.maxJSONImportBytes = 32 * 1024 * 1024;
    this.mediaRecorder = null;
    this.recordingStream = null;
    this.recordedChunks = [];
    this.isRecording = false;

    this.dataImportInput = this._createHiddenInput(
      ".json,application/json,text/plain",
      (file) => {
        if (this.pendingDataImportHandler) {
          this.pendingDataImportHandler(file);
          this.pendingDataImportHandler = null;
        }
      },
    );
    this.pendingDataImportHandler = null;
  }

  _logInfo(message, ...rest) {
    this._diagnosticsLogger.info(message, ...rest);
  }

  _logWarn(message, ...rest) {
    this._diagnosticsLogger.warn(message, ...rest);
  }

  _logError(message, ...rest) {
    this._diagnosticsLogger.error(message, ...rest);
  }

  _createHiddenInput(accept, onFile) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) onFile(file);
      input.value = "";
    });
    document.body.appendChild(input);
    return input;
  }

  _removeHiddenInput(input) {
    if (input && input.parentNode === document.body) {
      document.body.removeChild(input);
    }
  }

  openDataImportDialog(handler) {
    this.pendingDataImportHandler = handler;
    this.dataImportInput.value = "";
    this.dataImportInput.click();
  }

  _resolveCanvasElement() {
    const rendererCanvas = globalThis._renderer?.elt;
    if (rendererCanvas instanceof HTMLCanvasElement) {
      return rendererCanvas;
    }

    const drawingCanvas = globalThis.drawingContext?.canvas;
    if (drawingCanvas instanceof HTMLCanvasElement) {
      return drawingCanvas;
    }

    const globalCanvas = globalThis.canvas;
    if (globalCanvas instanceof HTMLCanvasElement) {
      return globalCanvas;
    }

    const domCanvas = document.querySelector("canvas");
    return domCanvas instanceof HTMLCanvasElement ? domCanvas : null;
  }

  startRecording() {
    if (this.isRecording) return;

    const sourceCanvas = this._resolveCanvasElement();
    if (!sourceCanvas) {
      this._logError("No valid canvas found");
      return;
    }

    this.recordedChunks = [];
    const types = ["video/webm;codecs=vp8", "video/mp4", "video/webm"];
    const supportedType = types.find((t) => MediaRecorder.isTypeSupported(t));

    if (!supportedType) {
      this._logError("No supported video format found");
      return;
    }

    try {
      const captureFps = this._getRecordingFPS();
      const bitrateBps = this._getRecordingBitrateBps();
      const stream = sourceCanvas.captureStream(captureFps);
      this.recordingStream = stream;
      const options = { mimeType: supportedType };
      if (bitrateBps > 0) {
        options.videoBitsPerSecond = bitrateBps;
      }
      this.mediaRecorder = new MediaRecorder(stream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.recordedChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        const chunks = this.recordedChunks.slice();
        this.recordedChunks = [];
        const blob = new Blob(chunks, { type: supportedType });
        const ext = supportedType.includes("mp4") ? "mp4" : "webm";
        this._triggerDownload(
          URL.createObjectURL(blob),
          this._getFilename(ext),
        );

        this._releaseRecordingResources();
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.appcore.refreshGUI();
      const bitrateMbps = bitrateBps > 0 ? bitrateBps / 1e6 : 0;
      this._logInfo(
        `Recording started: ${supportedType}, fps=${captureFps}, bitrate=${bitrateMbps.toFixed(2)}Mbps`,
      );
    } catch (err) {
      this._logError("Recording failed:", err);
      this.stopRecording();
    }
  }

  stopRecording() {
    if (!this.mediaRecorder || !this.isRecording) return;
    this.mediaRecorder.stop();
    this.isRecording = false;
    this.appcore.refreshGUI();
  }

  _releaseRecordingResources() {
    if (this.mediaRecorder) {
      this.mediaRecorder.ondataavailable = null;
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.onerror = null;
      this.mediaRecorder = null;
    }

    if (this.recordingStream) {
      const tracks = this.recordingStream.getTracks();
      for (const track of tracks) {
        track.stop();
      }
      this.recordingStream = null;
    }
  }

  _getRecordingFPS() {
    const fps = Number(this.appcore.params?.recordingFPS);
    return Math.max(12, Math.min(120, Math.round(fps || 60)));
  }

  _getRecordingBitrateBps() {
    const mbps = Number(this.appcore.params?.videoBitrateMbps);
    const clampedMbps = Math.max(1, Math.min(64, mbps || 8));
    return Math.round(clampedMbps * 1e6);
  }

  exportImage() {
    try {
      const sourceCanvas = this._resolveCanvasElement();
      if (!sourceCanvas) {
        this._logError("Image export failed: no valid canvas found");
        return;
      }

      const filename = this._getFilename(this.appcore.params.imageFormat);
      const dot = filename.lastIndexOf(".");
      const basename = dot > 0 ? filename.slice(0, dot) : filename;
      const extension =
        dot > 0
          ? filename.slice(dot + 1)
          : String(this.appcore.params.imageFormat || "png");

      if (typeof saveCanvas === "function") {
        saveCanvas(sourceCanvas, basename, extension);
      } else if (typeof save === "function") {
        save(sourceCanvas, filename);
      } else {
        this._logError("Image export failed: no supported save method found");
        return;
      }

      this._logInfo("Image exported");
    } catch (err) {
      this._logError("Image export failed:", err);
    }
  }

  _readJSONFile(file, onSuccess) {
    if (!file || typeof file.size !== "number") {
      this._logError("JSON import failed: invalid file handle");
      return;
    }

    if (file.size > this.maxJSONImportBytes) {
      this._logError(
        `JSON import failed: file too large (${file.size} bytes, max ${this.maxJSONImportBytes})`,
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        onSuccess(parsed);
      } catch (err) {
        this._logError("JSON import failed:", err);
      }
    };
    reader.onerror = () => this._logError("File read failed");
    reader.readAsText(file);
  }

  _downloadJSON(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    this._triggerDownload(URL.createObjectURL(blob), filename);
  }

  _downloadText(content, filename, mimeType = "text/plain") {
    const blob = new Blob([String(content ?? "")], { type: mimeType });
    this._triggerDownload(URL.createObjectURL(blob), filename);
  }

  _triggerDownload(url, filename) {
    const anchor = document.createElement("a");
    anchor.style.display = "none";
    anchor.href = url;
    anchor.download = filename;

    document.body.appendChild(anchor);
    anchor.click();

    setTimeout(() => {
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }, 100);
  }

  _isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  _isSafeObjectKey(key) {
    return key !== "__proto__" && key !== "constructor" && key !== "prototype";
  }

  _cloneJSONCompatible(value) {
    if (ArrayBuffer.isView(value)) {
      return Array.from(value);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this._cloneJSONCompatible(entry));
    }
    if (this._isPlainObject(value)) {
      const out = {};
      for (const [key, entry] of Object.entries(value)) {
        if (!this._isSafeObjectKey(key)) continue;
        out[key] = this._cloneJSONCompatible(entry);
      }
      return out;
    }
    return value;
  }

  _mergeByTargetSchema(target, incoming) {
    if (!this._isPlainObject(target) || !this._isPlainObject(incoming)) {
      return;
    }

    for (const key of Object.keys(target)) {
      if (!(key in incoming)) continue;

      const sourceValue = incoming[key];
      const targetValue = target[key];

      if (ArrayBuffer.isView(targetValue)) {
        if (!Array.isArray(sourceValue) && !ArrayBuffer.isView(sourceValue)) {
          continue;
        }
        const typed = new targetValue.constructor(targetValue.length);
        const limit = Math.min(typed.length, sourceValue.length || 0);
        for (let i = 0; i < limit; i++) {
          const n = Number(sourceValue[i]);
          typed[i] = Number.isFinite(n) ? n : 0;
        }
        target[key] = typed;
        continue;
      }

      if (Array.isArray(targetValue)) {
        if (Array.isArray(sourceValue)) {
          const maxLength = targetValue.length > 0 ? targetValue.length : 1024;
          target[key] = this._cloneJSONCompatible(
            sourceValue.slice(0, maxLength),
          );
        }
        continue;
      }

      if (this._isPlainObject(targetValue)) {
        if (this._isPlainObject(sourceValue)) {
          this._mergeByTargetSchema(targetValue, sourceValue);
        }
        continue;
      }

      if (typeof targetValue === "number") {
        const n = Number(sourceValue);
        if (Number.isFinite(n)) target[key] = n;
        continue;
      }

      if (typeof targetValue === "boolean") {
        target[key] = Boolean(sourceValue);
        continue;
      }

      if (typeof targetValue === "string") {
        const text = String(sourceValue);
        target[key] = text.length > 1024 ? text.slice(0, 1024) : text;
        continue;
      }

      target[key] = this._cloneJSONCompatible(sourceValue);
    }
  }

  _applyMetadataSnapshot(metadata) {
    if (!metadata || typeof metadata !== "object") return;
    this.appcore.metadata = this._cloneJSONCompatible(metadata);
  }

  _getFilename(_extension) {
    throw new Error("Subclass must implement _getFilename()");
  }

  dispose() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    this._releaseRecordingResources();
    this.recordedChunks = [];
    this.pendingDataImportHandler = null;

    this._removeHiddenInput(this.dataImportInput);
    this.dataImportInput = null;
  }
}
