import { describe, expect, it } from "vitest";
import { isWorkerMessage, type WorkerRequest } from "../protocol";

describe("language-service protocol", () => {
  it("accepts a versioned completion request", () => {
    const message: WorkerRequest = {
      kind: "request",
      id: 7,
      method: "completion",
      params: {
        document: { uri: "file:///image.glsl", languageId: "glsl", version: 3 },
        position: { line: 2, character: 5 },
      },
    };
    expect(isWorkerMessage(JSON.parse(JSON.stringify(message)))).toBe(true);
  });

  it("rejects messages without a numeric request id", () => {
    expect(isWorkerMessage({ kind: "request", method: "completion", params: {} })).toBe(false);
  });

  it("accepts a response with a numeric request id", () => {
    expect(isWorkerMessage({ kind: "response", id: 7, result: [] })).toBe(true);
  });

  it("rejects a response without a numeric request id", () => {
    expect(isWorkerMessage({ kind: "response", id: "7" })).toBe(false);
  });

  it("accepts a diagnostics notification", () => {
    expect(isWorkerMessage({ kind: "notification", method: "diagnostics", params: {} })).toBe(true);
  });

  it("rejects a notification without a string method", () => {
    expect(isWorkerMessage({ kind: "notification", method: 7, params: {} })).toBe(false);
  });

  it.each([null, "message", 7, true])("rejects non-object worker message input: %j", (message) => {
    expect(isWorkerMessage(message)).toBe(false);
  });
});
