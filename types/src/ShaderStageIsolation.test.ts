import { describe, expect, it } from "vitest";
import { isolateShaderEntryPoints } from "./ShaderStageIsolation";

describe("shared shader stage isolation", () => {
  it("retains selected stages and transitive helpers without shifting lines", () => {
    const source = "fn leaf() -> f32 { return 1; }\r\nfn helper() -> f32 { return leaf(); }\r\n@fragment fn image() -> @location(0) vec4f { return vec4f(helper()); }\r\nfn computeHelper() { writeOutput(vec2u(0), vec4f(1)); }\r\n@compute @workgroup_size(1) fn simulate() { computeHelper(); }";
    const result = isolateShaderEntryPoints(source, "wgsl", ["image"]);
    expect(result).toContain("fn leaf"); expect(result).toContain("fn helper");
    expect(result).not.toContain("computeHelper"); expect(result).not.toContain("writeOutput");
    expect(result.length).toBe(source.length);
    expect(result.split(/\r?\n/).length).toBe(source.split(/\r?\n/).length);
  });

  it("preserves Slang overloads, initializer helpers and common references", () => {
    const source = 'float helper(float a) { return a; }\nfloat helper(float2 a) { return a.x; }\nfloat initialize() { return 1; }\nfloat value = initialize();\nfloat usedByCommon() { return value; }\n[shader("fragment")] float4 image() : SV_Target { return float4(helper(1)); }\n[shader("compute")] void simulate() {}';
    const result = isolateShaderEntryPoints(source, "slang", ["image"], ["float shared() { return usedByCommon(); }"]);
    expect(result).toContain("float helper(float a)");
    expect(result).toContain("float helper(float2 a)");
    expect(result).toContain("float initialize()");
    expect(result).toContain("float usedByCommon()");
    expect(result).not.toContain("void simulate");
  });

  it("retains Slang functions passed as values to generic helpers", () => {
    const source = 'float shade(float x) { return x; } float apply<F>(F f) { return f(1); } [shader("fragment")] float4 image() : SV_Target { return float4(apply(shade)); } [shader("compute")] void unused() {}';
    const result = isolateShaderEntryPoints(source, "slang", ["image"]);
    expect(result).toContain("float shade");
    expect(result).toContain("apply(shade)");
    expect(result).not.toContain("void unused");
  });

  it("preserves helper calls within struct methods and leaves GLSL unchanged", () => {
    const source = 'float helper() { return 1; } struct S { float method() { return helper(); } }; [shader("fragment")] float4 image() : SV_Target { return float4(1); }';
    expect(isolateShaderEntryPoints(source, "slang", ["image"])).toContain("float helper");
    expect(isolateShaderEntryPoints(source, "glsl", [])).toBe(source);
  });
});
