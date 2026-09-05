import { describe, expect, it } from "vitest";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";
import { buildSlangPassGraph } from "../../webgpu/SlangPassGraph";
import type { RenderPassNode, StorageBindingNode } from "../../types/PassGraph";
import type { ConfigInput } from "@shader-studio/types";

const keys = WebGPURenderingEngine as unknown as Record<"wgslCacheKey" | "pipelineCacheKey", (pass: RenderPassNode, common: string, storage: StorageBindingNode[]) => string>;
function pass(a: ConfigInput, b: ConfigInput) {
  return buildSlangPassGraph({ imageCode: "float4 mainImage(float2 p) { return inputs.a.Sample(p) + inputs.b.Sample(p); }", config: {
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
});
