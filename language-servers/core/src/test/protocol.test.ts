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
});
