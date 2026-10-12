import { describe, expect, it } from "vitest";
import * as keys from "../../webgpu/WebGPUCompileKeys";
import { buildSlangPassGraph } from "../../webgpu/SlangPassGraph";
import type { ConfigInput } from "@shader-studio/types";

function pass(a: ConfigInput, b: ConfigInput) {
  return buildSlangPassGraph({ imageCode: "float4 mainImage(float2 p) { return a.Sample(p) + b.Sample(p); }", config: {
    version: "1", passes: { Image: { inputs: { a, b } } },
  }, buffers: {}, canvasWidth: 2, canvasHeight: 2 }).passes[0];
}

describe.each(["wgslCacheKey", "pipelineCacheKey"] as const)("Slang %s dedup compatibility", key => {
  it("invalidates cached code/layout when sharing changes", () => {
    const texture = { type: "texture" as const, path: "a" };
    const shared = keys[key](pass(texture, texture), "", []);
    expect(keys[key](pass(texture, { ...texture, path: "b" }), "", [])).not.toBe(shared);
    expect(keys[key](pass(texture, { ...texture, wrap: "clamp" }), "", [])).not.toBe(shared);
  });
  it("reuses code/layout when only resource identity changes, preserving the sharing pattern", () => {
    const texture = { type: "texture" as const, path: "a" };
    const other = { ...texture, path: "b", wrap: "clamp" as const };
    expect(keys[key](pass(texture, texture), "", [])).toBe(keys[key](pass(other, other), "", []));
  });
  it("distinguishes cube-producing pass code from a 2d pass", () => {
    const config = { version: "1", passes: { Image: {}, Sky: { outputKind: "cubemap" as const } } } as unknown as import("@shader-studio/types").ShaderConfig;
    const cube = buildSlangPassGraph({ imageCode: "float4 mainImage(float2 p) { return 1; }", config, buffers: { Sky: "float4 mainCubemap(float2 p, float3 o, float3 d) { return 1; }" }, canvasWidth: 2, canvasHeight: 2 }).passes.find((node) => node.name === "Sky")!;
    const flat = { ...cube, outputKind: "2d" as const };
    expect(keys[key](cube, "", [])).not.toBe(keys[key](flat, "", []));
  });
});
