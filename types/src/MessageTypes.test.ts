import { describe, expect, expectTypeOf, it } from "vitest";
import type { ErrorMessage, LogMessage, ShaderSourceMessage } from "./MessageTypes";
import { NEW_SLANG_FILE_LANGUAGE_VERSION, type SlangDiagnostic } from "./SlangWorkspace";

describe("runtime Slang message contracts", () => {
  it("keeps old GLSL shader source messages valid without runtime fields", () => {
    const message: ShaderSourceMessage = {
      type: "shaderSource", code: "void main() {}", config: {}, path: "/shader.frag", buffers: {},
    };
    expect(message).not.toHaveProperty("workspace");
    expect(NEW_SLANG_FILE_LANGUAGE_VERSION).toBe("2026");
  });

  it("serializes a versioned Slang workspace and compile metadata", () => {
    const message: ShaderSourceMessage = {
      type: "shaderSource", code: "", config: {}, path: "/shader.slang", buffers: {}, language: "slang",
      workspace: { rootUri: "file:///shader.slang", files: [{ uri: "file:///shader.slang", path: "/workspace/shader.slang", source: "", version: 7 }] },
      diagnostics: [
        { severity: "error", message: "compile failed", source: "slang-compile", uri: "file:///shader.slang", range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } }, code: "E100", passName: "main" },
        { severity: "warning", message: "runtime warning", source: "webgpu", uri: "file:///shader.slang", range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } } },
      ],
      requestId: 11, compileGeneration: { id: 42, rootIndex: 0, rootCount: 1, rootPath: "/workspace/shader.slang" },
      compileScope: { rootUris: ["file:///shader.slang"], ownerId: "owner", generationId: 42 },
    };
    expect(structuredClone(message)).toEqual(message);
  });

  it("limits diagnostic sources to compile and WebGPU origins", () => {
    expectTypeOf<SlangDiagnostic["source"]>().toEqualTypeOf<"slang-compile" | "webgpu">();
    expectTypeOf<Extract<SlangDiagnostic["source"], "language-service">>().toEqualTypeOf<never>();
    const diagnostic: SlangDiagnostic = { severity: "error", message: "bad", source: "slang-compile", uri: "file:///shader.slang", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } };
    const error: ErrorMessage = { type: "error", payload: ["bad"], diagnostics: [diagnostic] };
    const log: LogMessage = { type: "log", payload: [], diagnostics: [diagnostic], compileScope: { rootUris: [] } };
    expect(error.diagnostics?.[0].source).toBe("slang-compile");
    expect(log.diagnostics?.[0].source).toBe("slang-compile");
  });
});
