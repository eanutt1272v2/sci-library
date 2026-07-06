/**
 * Post a message to a worker, guarding the two ways `postMessage` can fail: a
 * missing/invalid worker, and a throw from `postMessage` itself (e.g. a value
 * that can't be structured-cloned, or a transferable that's already detached).
 * Returns whether the message was handed off, so a caller can decide whether to
 * retry or bail rather than having an exception cross the worker boundary.
 *
 * @param {Worker} worker - The target worker (or any object with `postMessage`).
 * @param {*} message - The message payload to send.
 * @param {Transferable[]} [transfers=[]] - Transfer list handed to `postMessage`.
 * @param {string} [context] - Short label for the log line on failure.
 * @returns {boolean} `true` if the message was posted, `false` otherwise.
 */
function safePostMessage(worker, message, transfers = [], context) {
  if (!worker || typeof worker.postMessage !== "function") {
    console.warn(
      `[WorkerMessaging] Skipped ${context || "worker post"}: worker unavailable`,
    );
    return false;
  }

  const transferList = Array.isArray(transfers) ? transfers : [];

  try {
    worker.postMessage(message, transferList);
    return true;
  } catch (error) {
    console.error(
      `[WorkerMessaging] Failed ${context || "worker post"}`,
      error,
    );
    return false;
  }
}

export { safePostMessage };
