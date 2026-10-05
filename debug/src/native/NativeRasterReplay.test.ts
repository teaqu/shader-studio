import { describe, expect, it } from "vitest";
import { buildNativeRasterReplay } from "./NativeRasterReplay";

describe("native raster debug interfaces", () => {
  it("keeps WGSL structured inputs and color/depth outputs", () => {
    const source = `struct Inputs { @builtin(position) pos: vec4f, @location(0) uv: vec2f, }
struct Outputs { @location(0) color: vec4f, @builtin(frag_depth) depth: f32, }
@fragment fn shade(input: Inputs) -> Outputs { return Outputs(vec4f(input.uv, 0, 1), 0.5); }`;
    const replay = buildNativeRasterReplay(source, "wgsl", "shade", "_debug");
    expect(typeof replay).not.toBe("string");
    if (typeof replay === "string") {
      return;
    }
    expect(replay.wrapperHeader).toBe("@fragment fn shade(input: Inputs) -> Outputs ");
    expect(replay.call).toBe("_debug_userMain(input)");
    expect(replay.returnColor("result", "value")).toContain("result.color = value;");
    expect(replay.returnColor("result", "value")).toContain("return result;");
  });

  it("keeps direct WGSL varying and builtin parameters", () => {
    const source = `@fragment fn shade(@location(0) @interpolate(flat) id: u32, @builtin(front_facing) front: bool) -> @location(0) vec4f { return vec4f(); }`;
    const replay = buildNativeRasterReplay(source, "wgsl", "shade", "_debug");
    expect(typeof replay).not.toBe("string");
    if (typeof replay === "string") {
      return;
    }
    expect(replay.call).toBe("_debug_userMain(id, front)");
    expect(replay.wrapperHeader).toContain("@interpolate(flat)");
    expect(replay.returnColor("result", "value")).toBe("return value;");
  });

  it("keeps Slang structured inputs and semantic outputs", () => {
    const source = `struct Inputs { float4 position : SV_Position; float2 uv : TEXCOORD0; };
struct Outputs { float4 color : SV_Target0; float depth : SV_Depth; };
[shader("fragment")] Outputs shade(Inputs input) { Outputs output; return output; }`;
    const replay = buildNativeRasterReplay(source, "slang", "shade", "_debug");
    expect(typeof replay).not.toBe("string");
    if (typeof replay === "string") {
      return;
    }
    expect(replay.wrapperHeader).toContain('[shader("fragment")] Outputs shade(Inputs input)');
    expect(replay.returnColor("result", "value")).toBe("result.color = value; return result;");
  });

  it("diagnoses missing, ambiguous and unsupported color outputs", () => {
    expect(buildNativeRasterReplay("", "wgsl", "missing", "_debug")).toContain("not found");
    const source = `@fragment fn a() -> @location(0) vec4f {} @fragment fn b() -> @location(0) vec4f {}`;
    expect(buildNativeRasterReplay(source, "wgsl", undefined, "_debug")).toContain("Select");
    expect(buildNativeRasterReplay("@fragment fn shade() -> @location(0) vec2f {}", "wgsl", "shade", "_debug")).toContain("four-component");
  });
});
