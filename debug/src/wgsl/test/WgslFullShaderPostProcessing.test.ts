import { describe, expect, it } from "vitest";
import { applyWgslFullShaderPostProcessing } from "../WgslFullShaderPostProcessing";

const SHADER = [
  "fn mainImage(coord: vec2f) -> vec4f {",
  "  return vec4f(coord.x, 0.0, 0.0, 1.0);",
  "}",
].join("\n");

describe("applyWgslFullShaderPostProcessing", () => {
  it("returns null when no post-processing is requested", () => {
    expect(applyWgslFullShaderPostProcessing(SHADER, { normalizeMode: "off", stepEdge: null })).toBeNull();
  });

  it("renames mainImage and appends a post-processed wrapper", () => {
    const output = applyWgslFullShaderPostProcessing(SHADER, { normalizeMode: "soft", stepEdge: 0.5 });

    expect(output).toContain("_ssdbg_full_userMain");
    expect(output).toContain("fn mainImage(coord: vec2f) -> vec4f");
    expect(output).toContain("/ (abs(");
    expect(output).toContain("step(vec3f(0.5000)");
    // The renamed entry keeps the original body exactly once.
    expect(output?.match(/return vec4f\(coord\.x, 0\.0, 0\.0, 1\.0\);/g)).toHaveLength(1);
  });

  it("returns null when there is no vec4f mainImage entry", () => {
    expect(applyWgslFullShaderPostProcessing("var<private> g: f32 = 1.0;\n", { normalizeMode: "abs", stepEdge: null })).toBeNull();
    const compute = "@compute @workgroup_size(8)\nfn mainCompute() {}";
    expect(applyWgslFullShaderPostProcessing(compute, { normalizeMode: "abs", stepEdge: null })).toBeNull();
  });

  it("post-processes the selected native fragment while preserving its public entry point", () => {
    const native = [
      "fn mainImage(coord: vec2f) -> vec4f { return vec4f(coord, 0.0, 1.0); }",
      "@fragment fn unused() -> @location(0) vec4f { return vec4f(0.0); }",
      "@fragment fn image(@builtin(position) p: vec4f) -> @location(0) vec4f { return vec4f(p.x); }",
    ].join("\n");
    const output = applyWgslFullShaderPostProcessing(native, { normalizeMode: "abs", stepEdge: null }, "image");

    expect(output).toMatch(/fn _ssdbg_full_userMain\(\s*p: vec4f\s*\)/);
    expect(output).toContain("@fragment fn image(@builtin(position) p: vec4f) -> @location(0) vec4f");
    expect(output).toContain("_ssdbg_full_userMain(p)");
    expect(output).toContain("fn mainImage(coord: vec2f) -> vec4f");
    expect(output).toContain("@fragment fn unused()");
  });

  it("preserves the generic native color return type", () => {
    const native = "@fragment fn image() -> @location(0) vec4<f32> { return vec4<f32>(1); }";
    const output = applyWgslFullShaderPostProcessing(native, { normalizeMode: "abs", stepEdge: null }, "image");
    expect(output).toContain("var result: vec4<f32> = _ssdbg_full_userMain();");
  });

  it("post-processes a native varying and structured color/depth output", () => {
    const native = `struct Inputs { @builtin(position) pos: vec4f, @location(0) uv: vec2f, }
struct Outputs { @location(0) color: vec4f, @builtin(frag_depth) depth: f32, }
@fragment fn image(input: Inputs) -> Outputs { return Outputs(vec4f(input.uv, 0.0, 1.0), 0.5); }`;
    const output = applyWgslFullShaderPostProcessing(native, { normalizeMode: "abs", stepEdge: null }, "image");
    expect(output).toContain("@fragment fn image(input: Inputs) -> Outputs");
    expect(output).toContain("var result: Outputs = _ssdbg_full_userMain(input);");
    expect(output).toContain("result.color = vec4f(abs((result.color).rgb)");
    expect(output).toContain("return result;");
  });
});
