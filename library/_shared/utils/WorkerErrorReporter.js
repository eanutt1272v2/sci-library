/**
 * Shared worker-side error reporting.
 *
 * Both compute workers (PsiWorker, FluviaWorker) need the same three things: a
 * normalised `{type:"workerError"}` payload, a reporter that posts it to the
 * main thread (logging locally as a fallback), and the `onerror` /
 * `onunhandledrejection` wiring. This lived duplicated verbatim in each worker
 * — bar the log tag — until both became real ES-module workers and could
 * import it.
 */

/**
 * Normalise any thrown value into a structured worker-error message.
 *
 * @param {string} stage - Where the failure happened (e.g. "runtime", "onmessage").
 * @param {*} error - The thrown value; may or may not be an Error.
 * @returns {{type: "workerError", stage: string, name: string, message: string, stack: string}}
 */
function toWorkerErrorPayload(stage, error) {
  if (error && typeof error === "object") {
    return {
      type: "workerError",
      stage,
      name: String(error.name || "Error"),
      message: String(error.message || "Worker failure"),
      stack: String(error.stack || ""),
    };
  }

  return {
    type: "workerError",
    stage,
    name: "Error",
    message: String(error || "Worker failure"),
    stack: "",
  };
}

/**
 * Install error reporting on a worker global scope: wires `onerror` and
 * `onunhandledrejection`, and returns a `report(stage, error)` the worker body
 * can also call directly (e.g. from an `onmessage` catch).
 *
 * @param {Object} scope - The worker global (`self`), passed explicitly so this
 *   makes no hidden global assumption and stays testable with a fake scope.
 * @param {string} label - Log tag for this worker, e.g. "PsiWorker".
 * @returns {(stage: string, error: *) => void} The reporter.
 */
function installWorkerErrorReporter(scope, label) {
  function report(stage, error) {
    const payload = toWorkerErrorPayload(stage, error);
    try {
      scope.postMessage(payload);
    } catch {
      console.warn(
        `[${label}] Failed to post error message to main thread. Original error:`,
        payload,
      );
    }
    try {
      console.error(`[${label}] ${payload.stage}: ${payload.message}`);
    } catch {
      // A failure while logging an error has nowhere left to go; swallow it.
    }
  }

  scope.onerror = function (message, _source, _lineno, _colno, error) {
    report("runtime", error || message);
    return false;
  };

  scope.onunhandledrejection = function (event) {
    report("unhandledrejection", event?.reason);
  };

  return report;
}

export { toWorkerErrorPayload, installWorkerErrorReporter };
