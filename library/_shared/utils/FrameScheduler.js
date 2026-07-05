/**
 * Defer a task so it runs without blocking the current draw frame.
 *
 * Walks a three-stage fallback chain, using the best mechanism available in the
 * host: schedule past the next paint with `requestAnimationFrame`, then off the
 * critical path with `requestIdleCallback` (bounded by `timeoutMs` so it can't be
 * starved indefinitely), then onto a macrotask via `MessageChannel` — falling back
 * to `queueMicrotask`/a resolved promise where neither timer exists. Any error the
 * task throws is caught and reported so a failed deferred task can't take down the
 * frame it was deferred out of.
 *
 * @param {Function} task - The work to run later. Non-functions are ignored.
 * @param {Object} [options]
 * @param {string} [options.label="deferred task"] - Tag used in the error log.
 * @param {number} [options.timeoutMs=120] - Idle-callback timeout, in ms.
 * @param {boolean} [options.useIdle=true] - Whether to try `requestIdleCallback`.
 * @param {number} [options.fallbackDelayMs=0] - Extra delay before the macrotask;
 *   when > 0 a plain `setTimeout` is used instead of `MessageChannel`.
 * @returns {void}
 */
function scheduleFrameFriendlyTask(task, options = {}) {
  if (typeof task !== "function") {
    return;
  }

  const {
    label = "deferred task",
    timeoutMs = 120,
    useIdle = true,
    fallbackDelayMs = 0,
  } = options || {};

  const safeDelay = Math.max(0, Math.floor(Number(fallbackDelayMs) || 0));
  const safeTimeout = Math.max(0, Math.floor(Number(timeoutMs) || 120));

  const scheduleMacrotask = (fn, delayMs = 0) => {
    const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
    if (delay > 0) {
      setTimeout(fn, delay);
      return;
    }

    if (typeof MessageChannel === "function") {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.onmessage = null;
        fn();
      };
      channel.port2.postMessage(0);
      return;
    }

    if (typeof queueMicrotask === "function") {
      queueMicrotask(fn);
      return;
    }

    Promise.resolve().then(fn);
  };

  const runTask = () => {
    try {
      task();
    } catch (error) {
      console.error(`[FrameScheduler] ${label} failed:`, error);
    }
  };

  const scheduleOutsideRaf = () => {
    if (useIdle && typeof requestIdleCallback === "function") {
      try {
        requestIdleCallback(
          () => {
            scheduleMacrotask(runTask, safeDelay);
          },
          { timeout: safeTimeout },
        );
        return;
      } catch (error) {
        console.warn("[FrameScheduler] requestIdleCallback failed", error);
      }
    }

    scheduleMacrotask(runTask, safeDelay);
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      scheduleOutsideRaf();
    });
    return;
  }

  scheduleOutsideRaf();
}

export { scheduleFrameFriendlyTask };
