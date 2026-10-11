import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

function sources(language: "wgsl" | "slang"): { image: string; scene: string } {
  if (language === "wgsl") {
    return { image: `fn mainImage(coord: vec2f) -> vec4f { return vec4f(iChannel0Sample(coord / iResolution.xy).r, iChannel1Sample(coord / iResolution.xy).g, 0, 1); }`, scene: `struct Outputs { @location(1) normal: vec4f, @location(0) color: vec4f, }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p=array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
@fragment fn fragment(@builtin(position) p: vec4f) -> Outputs { return Outputs(vec4f(0,0.75,0,1), vec4f(0.25,0,0,1)); }` };
  }
  return { image: `float4 mainImage(float2 coord) { return float4(iChannel0.Sample(coord / iResolution.xy).r, iChannel1.Sample(coord / iResolution.xy).g, 0, 1); }`, scene: `struct Outputs { [[vk::location(1)]] float4 normal : SV_Target1; [[vk::location(0)]] float4 color : SV_Target0; };
[shader("vertex")] float4 vertex(uint i : SV_VertexID) : SV_Position { float2 p[3]={float2(-1,-1),float2(3,-1),float2(-1,3)}; return float4(p[i],0,1); }
[shader("fragment")] Outputs fragment(float4 p : SV_Position) { Outputs o; o.normal=float4(0,0.75,0,1); o.color=float4(0.25,0,0,1); return o; }` };
}

describe("native MRT routing", () => {
  it.each(["wgsl", "slang"] as const)("routes both out-of-order %s fragment locations into selected Image channels", { timeout: 30_000 }, async language => {
    const { image, scene } = sources(language);
    const config: ShaderConfig = { version: "1.0", passes: {
      BufferA: { path: `scene.${language}`, entryPoints: { vertex: "vertex", fragment: "fragment" }, outputs: [{ name: "colour" }, { name: "normal" }] },
      Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA", output: 0 }, iChannel1: { type: "buffer", source: "BufferA", output: 1 } } },
    } };
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ path: `image.${language}`, image, buffers: { BufferA: scene }, config });
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel).toEqual([64, 191, 0, 255]);
      }
      harness.resize(4, 4);
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel).toEqual([64, 191, 0, 255]);
      }
    } finally {
      harness.dispose();
    }
  });
});

function feedbackSources(language: "wgsl" | "slang"): { image: string; scene: string } {
  if (language === "wgsl") {
    return { image: `fn mainImage(coord: vec2f) -> vec4f { return vec4f(iChannel0Sample(vec2f(.5)).r, iChannel1Sample(vec2f(.5)).g, 0, 1); }`, scene: `struct Outputs { @location(0) first: vec4f, @location(1) second: vec4f, }
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p=array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
@fragment fn fragment() -> Outputs { return Outputs(vec4f(iChannel0Sample(vec2f(.5)).r + .2,0,0,1), vec4f(0,iChannel1Sample(vec2f(.5)).g + .2,0,1)); }` };
  }
  return { image: `float4 mainImage(float2 coord) { return float4(iChannel0.Sample(float2(.5)).r, iChannel1.Sample(float2(.5)).g, 0, 1); }`, scene: `struct Outputs { float4 first : SV_Target0; float4 second : SV_Target1; };
[shader("vertex")] float4 vertex(uint i : SV_VertexID) : SV_Position { float2 p[3]={float2(-1,-1),float2(3,-1),float2(-1,3)}; return float4(p[i],0,1); }
[shader("fragment")] Outputs fragment() { Outputs o; o.first=float4(iChannel0.Sample(float2(.5)).r+.2,0,0,1); o.second=float4(0,iChannel1.Sample(float2(.5)).g+.2,0,1); return o; }` };
}

describe("native MRT feedback", () => {
  it.each(["wgsl", "slang"] as const)("preserves every %s attachment through feedback", { timeout: 30_000 }, async language => {
    const { image, scene } = feedbackSources(language);
    const config: ShaderConfig = { version: "1.0", passes: {
      BufferA: { path: `feedback.${language}`, entryPoints: { vertex: "vertex", fragment: "fragment" }, outputs: [{}, {}], inputs: { iChannel0: { type: "buffer", source: "BufferA", output: 0 }, iChannel1: { type: "buffer", source: "BufferA", output: 1 } } },
      Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA", output: 0 }, iChannel1: { type: "buffer", source: "BufferA", output: 1 } } },
    } };
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ path: `feedback-image.${language}`, image, buffers: { BufferA: scene }, config });
      const first = await harness.renderAndReadPixels();
      const second = await harness.renderAndReadPixels();
      expect(first.every(pixel => pixel[0] === 51 && pixel[1] === 51)).toBe(true);
      expect(second.every(pixel => pixel[0] === 102 && pixel[1] === 102)).toBe(true);
      // The engine's resize path is exercised by the dedicated runtime-resize suite;
      // this regression pins feedback across every attachment before that resize path.
    } finally {
      harness.dispose();
    }
  });
});

function fiveOutputSource(language: "wgsl" | "slang"): { image: string; scene: string } {
  if (language === "wgsl") {
    return { image: `fn mainImage(coord: vec2f) -> vec4f { let uv=coord/iResolution.xy; return vec4f(iChannel0Sample(uv).r+iChannel1Sample(uv).r,iChannel2Sample(uv).r+iChannel3Sample(uv).r,iChannel4Sample(uv).r,1); }`, scene: `struct Outputs { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f, @location(3) d: vec4f, @location(4) e: vec4f, }
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
@fragment fn fragment()->Outputs { return Outputs(vec4f(.1,0,0,1),vec4f(.2,0,0,1),vec4f(.3,0,0,1),vec4f(.4,0,0,1),vec4f(.5,0,0,1)); }` };
  }
  return { image: `float4 mainImage(float2 coord) { float2 uv=coord/iResolution.xy; return float4(iChannel0.Sample(uv).r+iChannel1.Sample(uv).r,iChannel2.Sample(uv).r+iChannel3.Sample(uv).r,iChannel4.Sample(uv).r,1); }`, scene: `struct Outputs { float4 a:SV_Target0; float4 b:SV_Target1; float4 c:SV_Target2; float4 d:SV_Target3; float4 e:SV_Target4; };
[shader("vertex")] float4 vertex(uint i:SV_VertexID):SV_Position { float2 p[3]={float2(-1,-1),float2(3,-1),float2(-1,3)}; return float4(p[i],0,1); }
[shader("fragment")] Outputs fragment() { Outputs o; o.a=float4(.1,0,0,1);o.b=float4(.2,0,0,1);o.c=float4(.3,0,0,1);o.d=float4(.4,0,0,1);o.e=float4(.5,0,0,1);return o; }` };
}

describe("native five-output MRT", () => {
  it.each(["wgsl", "slang"] as const)("renders five rgba16float %s attachments when the device permits 40 bytes/sample", { timeout: 30_000 }, async language => {
    const { image, scene } = fiveOutputSource(language);
    const inputs = Object.fromEntries(Array.from({ length: 5 }, (_, output) => [`iChannel${output}`, { type: "buffer" as const, source: "BufferA", output }]));
    const config: ShaderConfig = { version: "1.0", passes: { BufferA: { path: `five.${language}`, outputFormat: "rgba16float", entryPoints: { vertex: "vertex", fragment: "fragment" }, outputs: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, {}] }, Image: { inputs } } };
    const harness = createShaderCanvasHarness(language);
    try {
      try {
        await harness.compile({ path: `five-image.${language}`, image, buffers: { BufferA: scene }, config });
      } catch (error) {
        expect(String(error)).toMatch(/MRT requests 5 colour attachments|bytes per sample/);
        return;
      }
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel[0]).toBeCloseTo(76, -1);
        expect(pixel[1]).toBeCloseTo(178, -1);
        expect(pixel[2]).toBeCloseTo(128, -1);
        expect(pixel[3]).toBe(255);
      }
    } finally {
      harness.dispose();
    }
  });
});
