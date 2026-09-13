import { describe, expect, it } from "vitest";
import { VariableCaptureBuilder } from "../VariableCaptureBuilder";

// Custom uniforms are declared in the compiler's header for the whole shader,
// so every pass compiles with every one of them in scope. The variable list is
// per-pass, so a pass that never mentions a uniform must not list it.
const uniforms = [
  { name: "uGain", type: "float" },
  { name: "uOffset", type: "vec2" },
  { name: "uGlow", type: "vec3" },
];

const imagePass = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec4 src = texture(iChannel0, uv);
  fragColor = vec4(src.rgb * uGain, 1.0);
}`;

describe("VariableCaptureBuilder.filterUsedCustomUniforms", () => {
  it("keeps only the uniforms the pass mentions", () => {
    expect(VariableCaptureBuilder.filterUsedCustomUniforms(imagePass, uniforms)).toEqual([
      { name: "uGain", type: "float" },
    ]);
  });

  it("keeps a uniform reached through a member access", () => {
    const code = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy + uOffset.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;

    expect(VariableCaptureBuilder.filterUsedCustomUniforms(code, uniforms)).toEqual([
      { name: "uOffset", type: "vec2" },
    ]);
  });

  it("keeps a uniform used only by a helper function in the same pass", () => {
    const code = `vec3 glow(vec3 col) {
  return col * uGlow;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(glow(vec3(1.0)), 1.0);
}`;

    expect(VariableCaptureBuilder.filterUsedCustomUniforms(code, uniforms)).toEqual([
      { name: "uGlow", type: "vec3" },
    ]);
  });

  it("keeps a uniform used at global scope", () => {
    const code = `float scale = uGain * 2.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(scale);
}`;

    expect(VariableCaptureBuilder.filterUsedCustomUniforms(code, uniforms)).toEqual([
      { name: "uGain", type: "float" },
    ]);
  });

  it("ignores a mention in a line comment", () => {
    const code = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // uGain is applied in BufferA
  fragColor = vec4(1.0);
}`;

    expect(VariableCaptureBuilder.filterUsedCustomUniforms(code, uniforms)).toEqual([]);
  });

  it("ignores a mention in a block comment", () => {
    const code = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  /* uGain and uGlow live in common.glsl */
  fragColor = vec4(1.0);
}`;

    expect(VariableCaptureBuilder.filterUsedCustomUniforms(code, uniforms)).toEqual([]);
  });

  it("does not match a name that is only part of a longer identifier", () => {
    const code = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float uGainBoost = 2.0;
  fragColor = vec4(uGainBoost);
}`;

    expect(VariableCaptureBuilder.filterUsedCustomUniforms(code, uniforms)).toEqual([]);
  });

  it("preserves the order the uniforms were declared in", () => {
    const code = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(uGlow * uGain, 1.0);
}`;

    expect(VariableCaptureBuilder.filterUsedCustomUniforms(code, uniforms)).toEqual([
      { name: "uGain", type: "float" },
      { name: "uGlow", type: "vec3" },
    ]);
  });

  it("returns an empty list when there are no uniforms", () => {
    expect(VariableCaptureBuilder.filterUsedCustomUniforms(imagePass, [])).toEqual([]);
  });

  it("returns an empty list for an empty pass", () => {
    expect(VariableCaptureBuilder.filterUsedCustomUniforms("", uniforms)).toEqual([]);
  });
});
