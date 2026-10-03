import { describe, expect, it } from "vitest";
import { buildNativeFragmentReplay } from "./NativeFragmentReplay";

describe("native fragment pixel replay", () => {
  it.each(["vec4f", "vec4<f32>"])("demotes a selected WGSL %s fragment and preserves its body", type => {
    const source = `@fragment fn other() -> @location(0) vec4f { return vec4f(0); }\n@fragment fn image(@builtin(position) p: ${type}) -> @location(0) ${type} { return p; }`;
    const result = buildNativeFragmentReplay(source, "wgsl", "image", "_debug");
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") {
      return;
    }
    expect(result.entryName).toBe("image");
    expect(result.call).toBe("_debug_userMain(vec4f(coord.x, iResolution.y - coord.y, 0.0, 1.0))");
    expect(result.edits[0]?.text).toContain("fn _debug_userMain");
    expect(result.edits[0]?.text).not.toContain("@fragment");
    expect(source.slice(result.edits[0]!.end)).toContain("{ return p; }");
  });

  it.each(["wgsl", "slang"] as const)("supports parameter-free %s fragments", language => {
    const source = language === "wgsl" ? "@fragment fn image() -> @location(0) vec4f { return vec4f(1); }" : '[shader("fragment")] float4 image() : SV_Target { return float4(1); }';
    const result = buildNativeFragmentReplay(source, language, undefined, "_debug");
    expect(typeof result).not.toBe("string");
    if (typeof result !== "string") {
      expect(result.call).toBe("_debug_userMain()");
    }
  });

  it("demotes Slang position and target semantics", () => {
    const result = buildNativeFragmentReplay('[shader("fragment")] float4 image(float4 p : SV_Position) : SV_Target0 { return p; }', "slang", "image", "_debug");
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") {
      return;
    }
    expect(result.call).toContain("iResolution.y - fragCoord.y");
    expect(result.edits[0]?.text).not.toContain("shader");
    expect(result.edits[0]?.text).not.toContain("SV_");
  });

  it("diagnoses missing, ambiguous and unsupported interfaces", () => {
    expect(buildNativeFragmentReplay("", "wgsl", "missing", "_debug")).toContain("not found");
    const entries = "@fragment fn a() -> @location(0) vec4f {} @fragment fn b() -> @location(0) vec4f {}";
    expect(buildNativeFragmentReplay(entries, "wgsl", undefined, "_debug")).toContain("Select");
    expect(buildNativeFragmentReplay("@fragment fn image(@location(0) uv: vec2f) -> @location(0) vec4f {}", "wgsl", "image", "_debug")).toContain("raster replay");
    expect(buildNativeFragmentReplay('[shader("fragment")] Output image(Input i) : SV_Target {}', "slang", "image", "_debug")).toContain("raster replay");
  });
});
