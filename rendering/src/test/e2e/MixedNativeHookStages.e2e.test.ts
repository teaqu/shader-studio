import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

type Mode = "native-vertex" | "native-fragment";
function source(language: "wgsl" | "slang", mode: Mode): string {
  if (language === "wgsl") {
    return mode === "native-vertex" ? `struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) worldPosition: vec3f, @location(2) normal: vec3f, }
@vertex fn nativeVertex(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f) -> Out { return Out(vec4f(p * 0.75, 1), uv, p, n); }
fn mainImage(coord: vec2f) -> vec4f { return vec4f(coord / iResolution.xy, 0.2, 1); }` : `struct In { @location(0) uv: vec2f, @location(1) worldPosition: vec3f, @location(2) normal: vec3f, }
@fragment fn nativeFragment(input: In) -> @location(0) vec4f { return vec4f(input.uv, abs(input.normal.x), 1); }`;
  }
  return mode === "native-vertex" ? `struct Out { float4 position : SV_Position; float2 uv : TEXCOORD0; float3 worldPosition : TEXCOORD1; float3 normal : TEXCOORD2; };
[shader("vertex")] Out nativeVertex([[vk::location(0)]] float3 p : POSITION, [[vk::location(1)]] float3 n : NORMAL, [[vk::location(2)]] float2 uv : TEXCOORD0) { Out output; output.position=float4(p * .75,1); output.uv=uv; output.worldPosition=p; output.normal=n; return output; }
float4 mainImage(float2 coord) { return float4(coord / iResolution.xy, .2, 1); }` : `struct In { float2 uv : TEXCOORD0; float3 worldPosition : TEXCOORD1; float3 normal : TEXCOORD2; };
[shader("fragment")] float4 nativeFragment(In input) : SV_Target { return float4(input.uv, abs(input.normal.x), 1); }`;
}
function config(mode: Mode): ShaderConfig {
  return { version: "1.0", passes: { Image: { geometry: { type: "cube" }, entryPoints: mode === "native-vertex" ? { vertex: "nativeVertex" } : { fragment: "nativeFragment" } } } };
}

describe("mixed native and hook render stages", () => {
  it.each(["wgsl", "slang"] as const)("renders %s explicit native vertex with generated hook fragment", { timeout: 30_000 }, async language => {
    const harness = createShaderCanvasHarness(language); try {
      await harness.compile({ path: `/mixed-v.${language}`, image: source(language, "native-vertex"), config: config("native-vertex") }); expect((await harness.renderAndReadPixels()).some(pixel => pixel[0] > 5 && pixel[3] === 255)).toBe(true);
    } finally {
      harness.dispose();
    }
  });
  it.each(["wgsl", "slang"] as const)("renders %s explicit native fragment with generated hook mesh vertex", { timeout: 30_000 }, async language => {
    const harness = createShaderCanvasHarness(language); try {
      await harness.compile({ path: `/mixed-f.${language}`, image: source(language, "native-fragment"), config: config("native-fragment") }); expect((await harness.renderAndReadPixels()).some(pixel => pixel[0] > 5 && pixel[3] === 255)).toBe(true);
    } finally {
      harness.dispose();
    }
  });
});
