import { describe, expect, it } from "vitest";
import {
  SHADER_STUDIO_BUILTIN_UNIFORMS,
  SHADER_STUDIO_DOCUMENTATION_ONLY_BUILTIN_NAMES,
  SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS,
  SHADER_STUDIO_INDEXED_CHANNEL_PATTERN_SOURCE,
  SHADER_STUDIO_INDEXED_CHANNEL_METADATA_PATTERN_SOURCE,
  shaderStudioBuiltinUniformNames,
} from "../index";

describe("shaderStudioBuiltinUniformNames", () => {
  it("includes every catalog entry declared for the language, once each", () => {
    for (const language of ["glsl", "slang"] as const) {
      const names = shaderStudioBuiltinUniformNames(language);
      const expected = SHADER_STUDIO_BUILTIN_UNIFORMS
        .filter((uniform) => (
          uniform.languages.includes(language)
          && !SHADER_STUDIO_DOCUMENTATION_ONLY_BUILTIN_NAMES.has(uniform.name)
        ))
        .map((uniform) => uniform.name);

      expect(new Set(names).size).toBe(names.length);
      expect([...names].sort()).toEqual([...expected].sort());
    }
  });

  it("excludes documentation-only entries that name a family rather than a real symbol", () => {
    expect(shaderStudioBuiltinUniformNames("glsl")).not.toContain("iChannelN");
    expect(shaderStudioBuiltinUniformNames("slang")).not.toContain("iChannelN");
  });

  it("excludes uniforms declared for only the other language", () => {
    // iChannelLoaded and iDispatch are Slang-only in the catalog.
    expect(shaderStudioBuiltinUniformNames("glsl")).not.toContain("iChannelLoaded");
    expect(shaderStudioBuiltinUniformNames("glsl")).not.toContain("iDispatch");
    expect(shaderStudioBuiltinUniformNames("slang")).toContain("iChannelLoaded");
    expect(shaderStudioBuiltinUniformNames("slang")).toContain("iDispatch");
  });

  it("includes the camera and fragment-context symbols an editor should colour", () => {
    for (const language of ["glsl", "slang"] as const) {
      const names = shaderStudioBuiltinUniformNames(language);
      expect(names).toContain("iCameraPos");
      expect(names).toContain("iCameraDir");
      for (const symbol of SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS) {
        expect(names).toContain(symbol.name);
      }
    }
  });

  it("includes the ShaderToy channel metadata accessors", () => {
    for (const language of ["glsl", "slang"] as const) {
      const names = shaderStudioBuiltinUniformNames(language);
      for (const name of ["iCh0", "iCh1", "iCh2", "iCh3"]) {
        expect(names).toContain(name);
      }
    }
  });

  it("is stable across repeated calls", () => {
    expect(shaderStudioBuiltinUniformNames("glsl")).toBe(shaderStudioBuiltinUniformNames("glsl"));
  });
});

describe("SHADER_STUDIO_INDEXED_CHANNEL_PATTERN_SOURCE", () => {
  const pattern = new RegExp(`^${SHADER_STUDIO_INDEXED_CHANNEL_PATTERN_SOURCE}$`);

  it("matches any configured channel index, not just 0-9", () => {
    expect(pattern.test("iChannel0")).toBe(true);
    expect(pattern.test("iChannel9")).toBe(true);
    expect(pattern.test("iChannel10")).toBe(true);
    expect(pattern.test("iChannel128")).toBe(true);
  });

  it("does not match named multi-channel uniforms or non-numeric suffixes", () => {
    expect(pattern.test("iChannelResolution")).toBe(false);
    expect(pattern.test("iChannelTime")).toBe(false);
    expect(pattern.test("iChannelLoaded")).toBe(false);
    expect(pattern.test("iChannelN")).toBe(false);
    expect(pattern.test("iChannel")).toBe(false);
  });
});

describe("SHADER_STUDIO_INDEXED_CHANNEL_METADATA_PATTERN_SOURCE", () => {
  const pattern = new RegExp(`^${SHADER_STUDIO_INDEXED_CHANNEL_METADATA_PATTERN_SOURCE}$`);

  it("matches legacy metadata accessors for every configured channel index", () => {
    expect(pattern.test("iCh0")).toBe(true);
    expect(pattern.test("iCh4")).toBe(true);
    expect(pattern.test("iCh1023")).toBe(true);
    expect(pattern.test("iChannel4")).toBe(false);
    expect(pattern.test("iCh4Extra")).toBe(false);
  });
});
