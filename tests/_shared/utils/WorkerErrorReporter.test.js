import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  toWorkerErrorPayload,
  installWorkerErrorReporter,
} from "../../../library/_shared/utils/WorkerErrorReporter.js";

describe("toWorkerErrorPayload", () => {
  test("normalises a real Error, preserving name/message/stack", () => {
    const err = new TypeError("bad thing");
    const payload = toWorkerErrorPayload("compute", err);
    assert.equal(payload.type, "workerError");
    assert.equal(payload.stage, "compute");
    assert.equal(payload.name, "TypeError");
    assert.equal(payload.message, "bad thing");
    assert.ok(payload.stack.length > 0);
  });

  test("a non-object thrown value becomes a generic Error payload", () => {
    const payload = toWorkerErrorPayload("runtime", "just a string");
    assert.deepEqual(payload, {
      type: "workerError",
      stage: "runtime",
      name: "Error",
      message: "just a string",
      stack: "",
    });
  });

  test("null/undefined falls back to a default message", () => {
    assert.equal(toWorkerErrorPayload("x", null).message, "Worker failure");
    assert.equal(toWorkerErrorPayload("x", undefined).message, "Worker failure");
  });
});

describe("installWorkerErrorReporter", () => {
  function makeScope() {
    return {
      posted: [],
      postMessage(msg) {
        this.posted.push(msg);
      },
    };
  }

  test("wires onerror and onunhandledrejection and returns a reporter", () => {
    const scope = makeScope();
    const report = installWorkerErrorReporter(scope, "TestWorker");
    assert.equal(typeof report, "function");
    assert.equal(typeof scope.onerror, "function");
    assert.equal(typeof scope.onunhandledrejection, "function");
  });

  test("the returned reporter posts a structured payload to the scope", () => {
    const scope = makeScope();
    const report = installWorkerErrorReporter(scope, "TestWorker");
    report("onmessage", new Error("boom"));
    assert.equal(scope.posted.length, 1);
    assert.equal(scope.posted[0].stage, "onmessage");
    assert.equal(scope.posted[0].message, "boom");
  });

  test("onerror reports the error arg (5th param) and returns false", () => {
    const scope = makeScope();
    installWorkerErrorReporter(scope, "TestWorker");
    const result = scope.onerror("msg", "src", 1, 2, new Error("real"));
    assert.equal(result, false);
    assert.equal(scope.posted[0].stage, "runtime");
    assert.equal(scope.posted[0].message, "real");
  });

  test("onerror falls back to the message string when no error object is given", () => {
    const scope = makeScope();
    installWorkerErrorReporter(scope, "TestWorker");
    scope.onerror("script error", "src", 1, 2, null);
    assert.equal(scope.posted[0].message, "script error");
  });

  test("onunhandledrejection reports event.reason under the right stage", () => {
    const scope = makeScope();
    installWorkerErrorReporter(scope, "TestWorker");
    scope.onunhandledrejection({ reason: new Error("rejected") });
    assert.equal(scope.posted[0].stage, "unhandledrejection");
    assert.equal(scope.posted[0].message, "rejected");
  });

  test("a postMessage that throws does not propagate out of the reporter", () => {
    const scope = {
      postMessage() {
        throw new Error("channel closed");
      },
    };
    const report = installWorkerErrorReporter(scope, "TestWorker");
    // Must not throw despite postMessage failing (it logs and moves on).
    assert.doesNotThrow(() => report("compute", new Error("original")));
  });
});
