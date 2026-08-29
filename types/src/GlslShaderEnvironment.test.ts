import { describe, expect, it } from "vitest";
import {
  buildGlslCompatibilityUniformDeclarationLines,
  GLSL_STABLE_DECLARATION_LINES,
  GLSL_STABLE_NAMES,
  glslSamplerType,
  resolveGlslInputBindings,
} from "./GlslShaderEnvironment";
import { GLSL_STABLE_DECLARATION_LINES as sharedDeclarationLines } from "./shader-environment/BuiltinUniforms";

describe("GLSL shader environment", () => {
  it("declares the complete stable Shader Studio environment", () => {
    expect(GLSL_STABLE_DECLARATION_LINES).toBe(sharedDeclarationLines);
    expect(GLSL_STABLE_DECLARATION_LINES).toEqual([
      "precision highp float;",
      "out vec4 fragColor;",
      "#define HW_PERFORMANCE 1",
      "uniform vec3 iResolution;",
      "uniform float iTime;",
      "uniform float iTimeDelta;",
      "uniform float iFrameRate;",
      "uniform vec4 iMouse;",
      "uniform int iFrame;",
      "uniform vec4 iDate;",
      "uniform float iChannelTime[1024];",
      "uniform float iSampleRate;",
      "uniform vec3 iCameraPos;",
      "uniform vec3 iCameraDir;",
    ]);
    expect(GLSL_STABLE_NAMES).toEqual(new Set([
      "fragColor", "HW_PERFORMANCE", "iResolution", "iTime", "iTimeDelta",
      "iFrameRate", "iMouse", "iFrame", "iDate", "iChannelTime",
      "iSampleRate", "iCameraPos", "iCameraDir",
    ]));
  });

  it("assigns inputs in insertion order without capping, and marks aliases", () => {
    const inputs = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [
      index === 0 ? "sourceTexture" : `iChannel${index}`,
      { type: index === 1 ? "cubemap" : "texture" },
    ]));
    const bindings = resolveGlslInputBindings(inputs);
    expect(bindings).toHaveLength(18);
    expect(bindings[0]).toEqual({
      slot: 0,
      key: "sourceTexture",
      isCustomName: true,
      samplerType: "sampler2D",
    });
    expect(bindings[1]?.samplerType).toBe("samplerCube");
    expect(bindings[16]?.key).toBe("iChannel16");
    expect(bindings[17]?.key).toBe("iChannel17");
  });

  it("builds the complete renderer-compatible anonymous uniform structs", () => {
    expect(buildGlslCompatibilityUniformDeclarationLines([
      "samplerCube",
      "sampler2D",
      "sampler3D",
      "samplerCube",
      "sampler2D",
    ])).toEqual([
      "uniform struct {",
      "  samplerCube sampler;",
      "  vec3 size;",
      "  float time;",
      "  int loaded;",
      "} iCh0;",
      "uniform struct {",
      "  sampler2D sampler;",
      "  vec3 size;",
      "  float time;",
      "  int loaded;",
      "} iCh1;",
      "uniform struct {",
      "  sampler3D sampler;",
      "  vec3 size;",
      "  float time;",
      "  int loaded;",
      "} iCh2;",
      "uniform struct {",
      "  samplerCube sampler;",
      "  vec3 size;",
      "  float time;",
      "  int loaded;",
      "} iCh3;",
      "uniform struct {",
      "  sampler2D sampler;",
      "  vec3 size;",
      "  float time;",
      "  int loaded;",
      "} iCh4;",
    ]);
  });

  it("maps renderer channel types without changing sampler spelling", () => {
    expect(glslSamplerType("2D")).toBe("sampler2D");
    expect(glslSamplerType("Cube")).toBe("samplerCube");
    expect(glslSamplerType("3D")).toBe("sampler3D");
  });
});
