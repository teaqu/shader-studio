import { describe, expect, it } from "vitest";
import { applySlangFullShaderPostProcessing, applyWgslFullShaderPostProcessing } from "@shader-studio/debug";
import type { ShaderConfig } from "@shader-studio/types";
import { imageConfigForActiveRenderPass } from "../../../../ui/src/lib/nativeRenderConfig";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

describe("active buffer full-shader debug rendering", () => {
  it.each(["wgsl", "slang"] as const)("remaps native and hook %s buffers over a native mesh Image", { timeout: 30_000 }, async language => {
    for (const native of [true, false]) {
      const source = language === "wgsl" ? native
        ? `@vertex fn bufferVertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1);
}
@fragment fn bufferFragment() -> @location(0) vec4f { return vec4f(0.25,0,0,1); }`
        : "fn mainImage(coord: vec2f) -> vec4f { return vec4f(0.25,0,0,1); }"
        : native ? `[shader("vertex")] float4 bufferVertex(uint i : SV_VertexID) : SV_Position {
  float2 p[3] = {float2(-1,-1),float2(3,-1),float2(-1,3)}; return float4(p[i],0,1);
}
[shader("fragment")] float4 bufferFragment() : SV_Target0 { return float4(0.25,0,0,1); }`
          : "float4 mainImage(float2 coord) { return float4(0.25,0,0,1); }";
      // Image intentionally has a different stage selection and mesh layout.
      const config: ShaderConfig = { version: "1.0", passes: {
        Image: { geometry: { type: "cube" }, entryPoints: { vertex: "imageVertex", fragment: "imageFragment" } },
        BufferA: { path: `buffer.${language}`, ...(native ? { entryPoints: { vertex: "bufferVertex", fragment: "bufferFragment" } } : {}) },
      } };
      const debugConfig = imageConfigForActiveRenderPass(config, "BufferA")!;
      const postProcess = language === "wgsl" ? applyWgslFullShaderPostProcessing : applySlangFullShaderPostProcessing;
      const processed = postProcess(source, { normalizeMode: "abs", stepEdge: null }, native ? "bufferFragment" : undefined);
      expect(processed).not.toBeNull();
      const harness = createShaderCanvasHarness(language);
      try {
        await harness.compile({ path: `/shaders/image.${language}`, image: processed!, buffers: { BufferA: source }, config: debugConfig });
        expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([51,0,0,255]));
        expect(config.passes.Image.entryPoints?.fragment).toBe("imageFragment");
      } finally {
        harness.dispose();
      }
    }
  });
});
