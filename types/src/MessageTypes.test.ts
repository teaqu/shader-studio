import { describe, expect, it } from "vitest";
import type { ErrorMessage, LogMessage, ShaderSourceMessage } from "./MessageTypes";
import { NEW_SLANG_FILE_LANGUAGE_VERSION } from "./SlangWorkspace";

describe("runtime Slang message contracts", () => {
  it("keeps old GLSL shader source messages valid without runtime fields", () => {
    const message: ShaderSourceMessage = {
      type: "shaderSource", code: "void main() {}", config: {}, path: "/shader.frag", buffers: {},
    };
    expect(message).not.toHaveProperty("workspace");
  });

  it("serializes a versioned Slang workspace and compile metadata", () => {
    const message: ShaderSourceMessage = {
      type: "shaderSource", code: "", config: {}, path: "/shader.slang", buffers: {}, language: "slang",
      workspace: { rootUri: "file:///shader.slang", files: [{ uri: "file:///shader.slang", path: "/workspace/shader.slang", source: "", version: NEW_SLANG_FILE_LANGUAGE_VERSION }] },
      requestId: "request-1", compileGeneration: { id: "generation-1", rootIndex: 0, rootCount: 1, rootPath: "/workspace/shader.slang" },
      compileScope: { rootUris: ["file:///shader.slang"], ownerId: "owner", generationId: "generation-1" },
    };
    expect(structuredClone(message)).toEqual(message);
  });

  it("limits runtime diagnostic sources to compilation sources", () => {
    const diagnostic = { severity: "error" as const, message: "bad", source: "slang-compile" as const };
    const error: ErrorMessage = { type: "error", payload: ["bad"], diagnostics: [diagnostic] };
    const log: LogMessage = { type: "log", payload: [], diagnostics: [diagnostic], compileScope: { rootUris: [] } };
    expect(error.diagnostics?.[0].source).toBe("slang-compile");
    expect(log.diagnostics?.[0].source).not.toBe("language-service");
  });
});
