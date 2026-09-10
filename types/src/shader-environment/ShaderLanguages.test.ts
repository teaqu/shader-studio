import { describe, expect, it } from "vitest";
import {
  SHADER_LANGUAGES,
  isShaderLanguageId,
  shaderLanguageForPath,
  shaderLanguageOrDefault,
} from "./ShaderLanguages";

describe("SHADER_LANGUAGES", () => {
  it("describes exactly the three supported languages", () => {
    expect(Object.keys(SHADER_LANGUAGES).sort()).toEqual(["glsl", "slang", "wgsl"]);
    for (const [id, descriptor] of Object.entries(SHADER_LANGUAGES)) {
      expect(descriptor.id).toBe(id);
      expect(descriptor.extensions.length).toBeGreaterThan(0);
      expect(descriptor.extensions[0]).toBeTruthy();
      expect(descriptor.monacoId).toBeTruthy();
      expect(descriptor.label).toBeTruthy();
    }
  });

  it("routes GLSL to WebGL and Slang/WGSL to WebGPU", () => {
    expect(SHADER_LANGUAGES.glsl.engine).toBe("webgl");
    expect(SHADER_LANGUAGES.slang.engine).toBe("webgpu");
    expect(SHADER_LANGUAGES.wgsl.engine).toBe("webgpu");
  });

  it("marks debugger and plan-based debugging per language", () => {
    expect(SHADER_LANGUAGES.wgsl.hasLanguageService).toBe(true);
    expect(SHADER_LANGUAGES.wgsl.hasDebugger).toBe(true);
    expect(SHADER_LANGUAGES.wgsl.hasDebugPlan).toBe(true);
    expect(SHADER_LANGUAGES.wgsl.hasImports).toBe(false);
    expect(SHADER_LANGUAGES.slang.hasLanguageService).toBe(true);
    expect(SHADER_LANGUAGES.slang.hasDebugger).toBe(true);
    expect(SHADER_LANGUAGES.slang.hasDebugPlan).toBe(true);
    expect(SHADER_LANGUAGES.slang.hasImports).toBe(true);
    expect(SHADER_LANGUAGES.glsl.hasLanguageService).toBe(true);
    expect(SHADER_LANGUAGES.glsl.hasDebugger).toBe(true);
    expect(SHADER_LANGUAGES.glsl.hasDebugPlan).toBe(false);
    expect(SHADER_LANGUAGES.glsl.hasImports).toBe(false);
  });
});

describe("isShaderLanguageId", () => {
  it("accepts each supported language", () => {
    expect(isShaderLanguageId("glsl")).toBe(true);
    expect(isShaderLanguageId("slang")).toBe(true);
    expect(isShaderLanguageId("wgsl")).toBe(true);
  });

  it("rejects anything else, including near-misses", () => {
    expect(isShaderLanguageId("")).toBe(false);
    expect(isShaderLanguageId("GLSL")).toBe(false);
    expect(isShaderLanguageId("hlsl")).toBe(false);
    expect(isShaderLanguageId("glsl ")).toBe(false);
  });
});

describe("shaderLanguageForPath", () => {
  it("resolves each canonical extension", () => {
    expect(shaderLanguageForPath("shader.glsl")).toBe("glsl");
    expect(shaderLanguageForPath("shader.slang")).toBe("slang");
    expect(shaderLanguageForPath("shader.wgsl")).toBe("wgsl");
  });

  it("resolves secondary GLSL extensions", () => {
    expect(shaderLanguageForPath("shader.frag")).toBe("glsl");
    expect(shaderLanguageForPath("shader.vert")).toBe("glsl");
  });

  it("matches extensions case-insensitively", () => {
    expect(shaderLanguageForPath("shader.SLANG")).toBe("slang");
    expect(shaderLanguageForPath("shader.WGSL")).toBe("wgsl");
    expect(shaderLanguageForPath("shader.Glsl")).toBe("glsl");
    expect(shaderLanguageForPath("shader.FRAG")).toBe("glsl");
  });

  it("uses the final extension when a path has multiple dots", () => {
    expect(shaderLanguageForPath("shader.buffera.vert.wgsl")).toBe("wgsl");
    expect(shaderLanguageForPath("archive.tar.glsl")).toBe("glsl");
  });

  it("handles directory prefixes", () => {
    expect(shaderLanguageForPath("/shaders/nested/image.wgsl")).toBe("wgsl");
    expect(shaderLanguageForPath("C:\\shaders\\image.slang")).toBe("slang");
  });

  it("returns null for unknown extensions, missing extensions, and trailing dots", () => {
    expect(shaderLanguageForPath("shader.hlsl")).toBeNull();
    expect(shaderLanguageForPath("shader")).toBeNull();
    expect(shaderLanguageForPath("shader.")).toBeNull();
    expect(shaderLanguageForPath("")).toBeNull();
  });
});

describe("shaderLanguageOrDefault", () => {
  it("passes valid ids through", () => {
    expect(shaderLanguageOrDefault("glsl")).toBe("glsl");
    expect(shaderLanguageOrDefault("slang")).toBe("slang");
    expect(shaderLanguageOrDefault("wgsl")).toBe("wgsl");
  });

  it("falls back to GLSL for missing or unknown values", () => {
    expect(shaderLanguageOrDefault(undefined)).toBe("glsl");
    expect(shaderLanguageOrDefault("")).toBe("glsl");
    expect(shaderLanguageOrDefault("hlsl")).toBe("glsl");
    expect(shaderLanguageOrDefault("WGSL")).toBe("glsl");
  });
});
