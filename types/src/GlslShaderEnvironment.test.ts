import { describe, expect, it } from "vitest";
import {
  GLSL_STABLE_DECLARATION_LINES,
  GLSL_STABLE_NAMES,
  glslSamplerType,
  resolveGlslInputBindings,
} from "./GlslShaderEnvironment";

describe("GLSL shader environment", () => {
  it("declares the complete stable Shader Studio environment", () => {
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
      "uniform float iChannelTime[4];",
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

  it("assigns inputs in insertion order, caps them at sixteen, and marks aliases", () => {
    const inputs = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [
      index === 0 ? "sourceTexture" : `iChannel${index}`,
      { type: index === 1 ? "cubemap" : "texture" },
    ]));
    const bindings = resolveGlslInputBindings(inputs);
    expect(bindings).toHaveLength(16);
    expect(bindings[0]).toEqual({
      slot: 0,
      key: "sourceTexture",
      isCustomName: true,
      samplerType: "sampler2D",
    });
    expect(bindings[1]?.samplerType).toBe("samplerCube");
  });

  it("maps renderer channel types without changing sampler spelling", () => {
    expect(glslSamplerType("2D")).toBe("sampler2D");
    expect(glslSamplerType("Cube")).toBe("samplerCube");
    expect(glslSamplerType("3D")).toBe("sampler3D");
  });
});
