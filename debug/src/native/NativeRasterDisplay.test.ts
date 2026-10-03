import { describe, expect, it } from "vitest";
import { projectNativeRasterDisplay } from "./NativeRasterDisplay";

describe("projectNativeRasterDisplay", () => {
  it("projects WGSL output one to location zero while retaining the original result fields", () => {
    const source = `struct Out { @location(0) colour: vec4f, @location(1) normal: vec4f, @builtin(frag_depth) depth: f32, }\n@fragment fn shade() -> Out { return Out(vec4f(0),vec4f(1),.5); }`;
    const projected = projectNativeRasterDisplay(source, "wgsl", "shade", 1);
    expect(projected).toContain("_ssdbg_display_out(result.normal, result.depth)");
    expect(projected).toContain("@builtin(frag_depth) depth");
    expect(projected).toContain("struct Out");
  });
  it("projects Slang output one", () => {
    const source = `struct Out { float4 colour:SV_Target0; float4 normal:SV_Target1; };\n[shader("fragment")] Out shade() { Out o; return o; }`;
    expect(projectNativeRasterDisplay(source, "slang", "shade", 1)).toContain("return result.normal;");
  });
});

it("does not borrow depth from an unrelated return struct", () => {
  const source = `struct Other { @builtin(frag_depth) unrelated: f32, }\nstruct Out { @location(0) color: vec4f, @location(1) selected: vec4f, }\n@fragment fn shade() -> Out { return Out(vec4f(0),vec4f(1)); }`;
  const projected = projectNativeRasterDisplay(source, "wgsl", "shade", 1)!;
  expect(projected).toContain("return result.selected;");
  expect(projected).not.toContain("_ssdbg_display_out");
});

it("replaces a direct Slang target semantic instead of appending a second one", () => {
  const source = `[shader("fragment")] float4 shade() : SV_Target1 { return float4(1); }`;
  const projected = projectNativeRasterDisplay(source, "slang", "shade", 1)!;
  expect(projected.match(/SV_Target/g)).toHaveLength(1);
});
