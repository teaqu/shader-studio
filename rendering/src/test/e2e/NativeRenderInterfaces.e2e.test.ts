import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

describe("native render stage interfaces", () => {
  it.each(["wgsl", "slang"] as const)("renders authored %s vertex-to-fragment varyings", { timeout: 30_000 }, async language => {
    const image = language === "wgsl" ? `struct Varyings { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertices(@builtin(vertex_index) i: u32) -> Varyings {
  let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return Varyings(vec4f(p[i],0,1), p[i] * 0.5 + 0.5);
}
@fragment fn image(input: Varyings) -> @location(0) vec4f { return vec4f(input.uv,0,1); }`
      : `struct Varyings { float4 position : SV_Position; float2 uv : TEXCOORD0; };
[shader("vertex")] Varyings vertices(uint i : SV_VertexID) {
  float2 p[3] = {float2(-1,-1),float2(3,-1),float2(-1,3)};
  Varyings output; output.position = float4(p[i],0,1); output.uv = p[i] * 0.5 + 0.5; return output;
}
[shader("fragment")] float4 image(Varyings input) : SV_Target0 { return float4(input.uv,0,1); }`;
    const config: ShaderConfig = { version: "1.0", passes: { Image: { entryPoints: { vertex: "vertices", fragment: "image" } } } };
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ path: `/varyings.${language}`, image, config });
      const pixels = await harness.renderAndReadPixels();
      expect(pixels.map(pixel => pixel[0])).toEqual([64,191,64,191]);
      expect(pixels.map(pixel => pixel[1])).toEqual([191,191,64,64]);
      expect(pixels.every(pixel => pixel[2] === 0 && pixel[3] === 255)).toBe(true);
    } finally {
      harness.dispose();
    }
  });

  it.each(["wgsl", "slang"] as const)("renders native %s stages using the supplied cube mesh layout", { timeout: 30_000 }, async language => {
    const image = language === "wgsl" ? `@vertex fn vertices(@location(0) position: vec3f) -> @builtin(position) vec4f { return vec4f(position.xy * 2,0.5,1); }
@fragment fn image() -> @location(0) vec4f { return vec4f(0,1,0,1); }`
      : `[shader("vertex")] float4 vertices([[vk::location(0)]] float3 position : POSITION) : SV_Position { return float4(position.xy * 2,0.5,1); }
[shader("fragment")] float4 image() : SV_Target0 { return float4(0,1,0,1); }`;
    const config: ShaderConfig = { version: "1.0", passes: { Image: { geometry: { type: "cube" }, entryPoints: { vertex: "vertices", fragment: "image" } } } };
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ path: `/mesh.${language}`, image, config });
      expect(await harness.renderAndReadPixels()).toEqual(Array(4).fill([0,255,0,255]));
    } finally {
      harness.dispose();
    }
  });
});
