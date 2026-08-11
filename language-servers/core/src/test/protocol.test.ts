import { describe, expect, it } from "vitest";
import {
  isWorkerMessage,
  type DiagnosticsWorkerNotification,
  type WorkerMethod,
  type WorkerRequest,
  type WorkerResponse,
} from "../protocol";

const REVISION = {
  uri: "file:///image.glsl",
  languageId: "glsl",
  version: 3,
  environmentGeneration: 8,
} as const;

describe("language-service protocol", () => {
  it("accepts a versioned completion request", () => {
    const message: WorkerRequest = {
      kind: "request",
      id: 7,
      method: "completion",
      params: {
        document: {
          uri: "file:///image.glsl",
          languageId: "glsl",
          version: 3,
          environmentGeneration: 8,
        },
        position: { line: 2, character: 5 },
      },
    };
    expect(isWorkerMessage(JSON.parse(JSON.stringify(message)))).toBe(true);
  });

  it("rejects an analysis request without its environment generation", () => {
    expect(isWorkerMessage({
      kind: "request",
      id: 7,
      method: "completion",
      params: {
        document: { uri: "file:///image.glsl", languageId: "glsl", version: 3 },
        position: { line: 2, character: 5 },
      },
    })).toBe(false);
  });

  it("rejects messages without a numeric request id", () => {
    expect(isWorkerMessage({ kind: "request", method: "completion", params: {} })).toBe(false);
  });

  it("rejects a lifecycle request without its required params property", () => {
    expect(isWorkerMessage({ kind: "request", id: 7, method: "initialize" })).toBe(false);
  });

  it.each([
    "completion",
    "hover",
    "definition",
    "signatureHelp",
    "documentSymbols",
    "diagnostics",
    "documentColors",
    "colorPresentations",
  ] satisfies WorkerMethod[])("accepts the closed analysis request method: %s", (method) => {
    expect(isWorkerMessage({
      kind: "request",
      id: 7,
      method,
      params: { document: REVISION },
    })).toBe(true);
  });

  it.each([
    "initialize",
    "syncEnvironment",
    "openDocument",
    "changeDocument",
    "closeDocument",
    "dispose",
  ] satisfies WorkerMethod[])("accepts the closed lifecycle request method: %s", (method) => {
    expect(isWorkerMessage({ kind: "request", id: 7, method, params: {} })).toBe(true);
  });

  it("rejects an arbitrary request method outside the closed worker union", () => {
    expect(isWorkerMessage({ kind: "request", id: 7, method: "shutdown", params: null })).toBe(false);
  });

  it("rejects a response that does not identify its closed request method", () => {
    expect(isWorkerMessage({ kind: "response", id: 7, result: [] })).toBe(false);
  });

  it("rejects an analysis response without its exact revision", () => {
    expect(isWorkerMessage({
      kind: "response",
      id: 7,
      method: "completion",
      result: [],
    })).toBe(false);
  });

  it("accepts a lifecycle response without a document revision", () => {
    expect(isWorkerMessage({
      kind: "response",
      id: 7,
      method: "initialize",
      result: {},
    })).toBe(true);
  });

  it("rejects a lifecycle response carrying a document revision", () => {
    expect(isWorkerMessage({
      kind: "response",
      id: 7,
      method: "initialize",
      revision: REVISION,
      result: {},
    })).toBe(false);
  });

  it("requires and accepts the exact revision on an analysis error response", () => {
    const error = { code: "internal", message: "analysis failed" };
    expect(isWorkerMessage({ kind: "response", id: 7, method: "completion", error })).toBe(false);
    expect(isWorkerMessage({
      kind: "response",
      id: 7,
      method: "completion",
      revision: REVISION,
      error,
    })).toBe(true);
  });

  it("rejects an arbitrary response method outside the closed worker union", () => {
    expect(isWorkerMessage({
      kind: "response",
      id: 7,
      method: "shutdown",
      result: undefined,
    })).toBe(false);
  });

  it("rejects responses with both or neither of result and error", () => {
    expect(isWorkerMessage({ kind: "response", id: 7, method: "initialize" })).toBe(false);
    expect(isWorkerMessage({
      kind: "response",
      id: 7,
      method: "initialize",
      result: {},
      error: { code: "internal", message: "analysis failed" },
    })).toBe(false);
  });

  it("round-trips the exact revision echoed by an analysis response", () => {
    const response: WorkerResponse = {
      kind: "response",
      id: 7,
      method: "completion",
      revision: {
        uri: "file:///image.glsl",
        languageId: "glsl",
        version: 3,
        environmentGeneration: 8,
      },
      result: [],
    };

    const roundTripped = JSON.parse(JSON.stringify(response)) as WorkerResponse;
    expect(isWorkerMessage(roundTripped)).toBe(true);
    expect(roundTripped.revision).toEqual(response.revision);
  });

  it("rejects a response without a numeric request id", () => {
    expect(isWorkerMessage({ kind: "response", id: "7", method: "initialize", result: {} })).toBe(false);
  });

  it("accepts a response with a structured worker error", () => {
    expect(isWorkerMessage({
      kind: "response",
      id: 7,
      method: "initialize",
      error: { code: "internal", message: "analysis failed" },
    })).toBe(true);
  });

  it.each([
    null,
    "analysis failed",
    { code: 500, message: "analysis failed" },
    { code: "internal" },
  ])("rejects a malformed response error: %j", (error) => {
    expect(isWorkerMessage({ kind: "response", id: 7, method: "initialize", error })).toBe(false);
  });

  it("accepts a diagnostics notification", () => {
    const notification: DiagnosticsWorkerNotification = {
      kind: "notification",
      method: "diagnostics",
      revision: {
        uri: "file:///image.glsl",
        languageId: "glsl",
        version: 3,
        environmentGeneration: 8,
      },
      params: [],
    };
    expect(isWorkerMessage(notification)).toBe(true);
  });

  it("rejects diagnostics without the exact document and environment revision", () => {
    expect(isWorkerMessage({
      kind: "notification",
      method: "diagnostics",
      revision: { uri: "file:///image.glsl", languageId: "glsl", version: 3 },
      params: [],
    })).toBe(false);
  });

  it("rejects a notification without a string method", () => {
    expect(isWorkerMessage({ kind: "notification", method: 7, params: {} })).toBe(false);
  });

  it("accepts a log notification", () => {
    expect(isWorkerMessage({ kind: "notification", method: "log", params: "ready" })).toBe(true);
  });

  it("rejects a log notification without its required params property", () => {
    expect(isWorkerMessage({ kind: "notification", method: "log" })).toBe(false);
  });

  it("rejects an arbitrary notification method outside the closed worker union", () => {
    expect(isWorkerMessage({ kind: "notification", method: "shutdown", params: null })).toBe(false);
  });

  it.each([null, "message", 7, true])("rejects non-object worker message input: %j", (message) => {
    expect(isWorkerMessage(message)).toBe(false);
  });
});
