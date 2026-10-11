import { describe, expect, it } from "vitest";
import { nativeRasterCoordinates } from "./NativeRasterCoordinates";

describe("native debug control coordinates", () => {
  it.each(["wgsl", "slang"] as const)("uses a direct %s position without colliding with the authored parameter", language => {
    const header = language === "wgsl"
      ? "@fragment fn shade(@builtin(position) coord: vec4f) -> @location(0) vec4f "
      : '[shader("fragment")] float4 shade(float4 fragCoord : SV_Position) : SV_Target0 ';
    const result = nativeRasterCoordinates("", header, language, "_debug", "shade");
    expect(result.header).toBe(header);
    expect(result.name).toBe("_debug_coordinate");
    expect(result.setup).toContain(language === "wgsl" ? "coord.x" : "fragCoord.x");
  });

  it("adds the position builtin after a trailing comma and ignores unrelated annotation parentheses", () => {
    const result = nativeRasterCoordinates("", "@diagnostic(off, derivative_uniformity) @fragment fn shade(@location(0) uv: vec2f,) -> @location(0) vec4f ", "wgsl", "_debug", "shade");
    expect(result.header).toContain("uv: vec2f, @builtin(position) _debug_position: vec4f)");
    expect(result.setup).toContain("iResolution.y - _debug_position.y");
  });

  it("finds a structured WGSL position field with an additional builtin attribute", () => {
    const source = "struct Inputs { @builtin(position) @invariant pos: vec4f, @location(0) uv: vec2f, }";
    const result = nativeRasterCoordinates(source, "@fragment fn shade(input: Inputs) -> @location(0) vec4f ", "wgsl", "_debug", "shade");
    expect(result.header).not.toContain("_debug_position");
    expect(result.setup).toContain("input.pos.x");
  });

  it("does not read a position field from a commented-out struct", () => {
    const source = "/* struct Inputs { @builtin(position) fake: vec4f, } */ struct Inputs { @location(0) uv: vec2f, }";
    const result = nativeRasterCoordinates(source, "@fragment fn shade(input: Inputs) -> @location(0) vec4f ", "wgsl", "_debug", "shade");
    expect(result.header).toContain("@builtin(position) _debug_position");
    expect(result.setup).not.toContain("input.fake");
  });
});
