import { describe, expect, it } from "vitest";
import { applySlangFullShaderPostProcessing, applyWgslFullShaderPostProcessing, SlangDebugEngine, WgslDebugEngine } from "@shader-studio/debug";
import type { DebugWorkspace, ShaderConfig } from "@shader-studio/types";
import type { CaptureResult, IVariableCapturer } from "../../capture/VariableCapturer";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

async function collect(capturer: IVariableCapturer, count: number): Promise<CaptureResult[]> {
  const deadline = performance.now() + 5_000;
  const results: CaptureResult[] = [];
  while (performance.now() < deadline) {
    results.push(...capturer.collectResults());
    if (results.length === count) {
      return results;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`Native fragment capture timed out: ${capturer.getLastError() ?? "no result"}`);
}

describe("native entry-point debug and capture", () => {
  it.each(["wgsl", "slang"] as const)("previews and captures a selected %s fragment and restores native rendering", { timeout: 30_000 }, async language => {
    const source = language === "wgsl" ? `@vertex fn vertices(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(p[i],0,1);
}
@fragment fn alternate() -> @location(0) vec4<f32> { return vec4f(0,1,0,1); }
@fragment fn image(@builtin(position) p: vec4f) -> @location(0) vec4<f32> {
  let value = 0.25 + iTime;
  return vec4f(value,0,0,1);
}
fn mainImage(coord: vec2f) -> vec4f { return vec4f(0,0,1,1); }` : `[shader("vertex")] float4 vertices(uint i : SV_VertexID) : SV_Position {
  float2 p[3] = {float2(-1,-1), float2(3,-1), float2(-1,3)};
  return float4(p[i],0,1);
}
[shader("fragment")] float4 alternate() : SV_Target { return float4(0,1,0,1); }
[shader("fragment")] float4 image(float4 p : SV_Position) : SV_Target {
  float value = 0.25 + iTime;
  return float4(value,0,0,1);
}
float4 mainImage(float2 coord) { return float4(0,0,1,1); }`;
    const path = `/shaders/native.${language}`;
    const config: ShaderConfig = { version: "1.0", passes: { Image: { entryPoints: { vertex: "vertices", fragment: "image" } } } };
    const harness = createShaderCanvasHarness(language);
    try {
      await harness.compile({ path, image: source, config });
      const workspace: DebugWorkspace = { rootUri: path, rootPath: path, passName: "Image", render: { entryPoint: "image" }, contentHash: "abcd1234",
        files: [{ uri: path, path, source, version: 1, moduleName: "", ownerPass: "Image" }] };
      const request = { workspace, sourceUri: path, position: { line: 6, character: 2 } };
      const debug = language === "wgsl" ? new WgslDebugEngine() : new SlangDebugEngine();
      const analysis = debug.analyze(request);
      if (!analysis.ok) {
        throw new Error(analysis.diagnostics[0]?.message);
      }
      const value = analysis.analysis.visibleValues.find(candidate => candidate.name === "value")!;
      const preview = debug.planPreview(request, { normalizeMode: "off", stepEdge: null });
      if (!preview.ok) {
        throw new Error(preview.diagnostics[0]?.message);
      }
      expect(await harness.engine.compileDebugPlan?.(preview.plan, config)).toMatchObject({ success: true });
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel.slice(0,3)).toEqual([64,64,64]);
      }
      const plan = debug.planCapture(request, [value.id]);
      if (!plan.ok) {
        throw new Error(plan.diagnostics[0]?.message);
      }
      const capturer = harness.engine.createVariableCapturer();
      try {
        capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(source, "Image", path));
        const root = plan.plan.files.find(file => file.uri === plan.plan.rootUri)!;
        const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: root.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
        const issued = await capturer.issueCaptureGrid(captures, harness.engine.getCaptureUniforms(), 1, 1);
        expect({ issued, error: capturer.getLastError() }).toEqual({ issued: captures.length, error: null });
        const results = await collect(capturer, captures.length);
        expect([...results.find(result => result.varName === "value")!.rgba]).toEqual([0.25,0.25,0.25,1]);
        expect(capturer.getLastError()).toBeNull();
      } finally {
        capturer.dispose();
      }
      await harness.compile({ path, image: source, config });
      for (const pixel of await harness.renderAndReadPixels()) {
        expect(pixel).toEqual([64,0,0,255]);
      }
    } finally {
      harness.dispose();
    }
  });

  it.each(["wgsl", "slang"] as const)("keeps native pixel coordinates while applying full normalize and step post-processing in %s", { timeout: 30_000 }, async language => {
    const source = language === "wgsl" ? `@vertex fn vertices(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(p[i],0,1);
}
@fragment fn alternate() -> @location(0) vec4<f32> { return vec4f(0,1,0,1); }
@fragment fn image(@builtin(position) p: vec4f) -> @location(0) vec4<f32> {
  return vec4f(p.y / iResolution.y, 0, 0, 1);
}
fn mainImage(coord: vec2f) -> vec4f { return vec4f(0,0,1,1); }` : `[shader("vertex")] float4 vertices(uint i : SV_VertexID) : SV_Position {
  float2 p[3] = {float2(-1,-1), float2(3,-1), float2(-1,3)};
  return float4(p[i],0,1);
}
[shader("fragment")] float4 alternate() : SV_Target { return float4(0,1,0,1); }
[shader("fragment")] float4 image(float4 p : SV_Position) : SV_Target {
  return float4(p.y / iResolution.y, 0, 0, 1);
}
float4 mainImage(float2 coord) { return float4(0,0,1,1); }`;
    const path = `/shaders/native-postprocess.${language}`;
    // Compile post-processed source with the original native pipeline selection.
    const config: ShaderConfig = { version: "1.0", passes: { Image: { entryPoints: { vertex: "vertices", fragment: "image" } } } };
    const postProcess = language === "wgsl" ? applyWgslFullShaderPostProcessing : applySlangFullShaderPostProcessing;
    const harness = createShaderCanvasHarness(language);
    try {
      const normalized = postProcess(source, { normalizeMode: "abs", stepEdge: null }, "image");
      expect(normalized).not.toBeNull();
      await harness.compile({ path, image: normalized!, config });
      const normalizedPixels = await harness.renderAndReadPixels();
      // Positions are top-left native pixels: rows must become brighter down the image.
      expect(normalizedPixels[0]).toEqual([51, 0, 0, 255]);
      expect(normalizedPixels[2]).toEqual([109, 0, 0, 255]);

      const stepped = postProcess(source, { normalizeMode: "off", stepEdge: 0.5 }, "image");
      expect(stepped).not.toBeNull();
      await harness.compile({ path, image: stepped!, config });
      const steppedPixels = await harness.renderAndReadPixels();
      expect(steppedPixels[0]).toEqual([0, 0, 0, 255]);
      expect(steppedPixels[2]).toEqual([255, 0, 0, 255]);
    } finally {
      harness.dispose();
    }
  });

});
