import { describe, expect, it } from "vitest";
import { SlangDebugEngine, WgslDebugEngine } from "@shader-studio/debug";
import type { DebugWorkspace, ShaderConfig } from "@shader-studio/types";
import type { CaptureResult, IVariableCapturer } from "../../capture/VariableCapturer";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

async function collect(capturer: IVariableCapturer, count: number): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    results.push(...capturer.collectResults());
    if (results.length === count) {
      return results;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(capturer.getLastError() ?? "Raster capture did not resolve");
}

function sourceFor(language: "wgsl" | "slang", mesh: boolean): string {
  if (language === "wgsl") {
    return `struct Varyings { @builtin(position) position: vec4f, @location(0) uv: vec2f, }
struct Output { @location(0) color: vec4f, ${mesh ? "@builtin(frag_depth) depth: f32," : ""} }
@vertex fn vertices(${mesh ? "@location(0) position: vec3f" : "@builtin(vertex_index) index: u32"}) -> Varyings {
  ${mesh ? "let p = position.xy * 2; let z = position.z * 0.25 + 0.5;" : "let triangle = array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); let p = triangle[index]; let z = 0.5;"}
  return Varyings(vec4f(p,z,1), p * 0.5 + 0.5);
}
@fragment fn image(input: Varyings) -> Output {
  ${mesh ? "let value = vec3f(input.uv, input.position.z);" : "let value = input.uv;"}
  return Output(vec4f(value.xy, 0.1, 1)${mesh ? ", input.position.z" : ""});
}`;
  }
  return `struct Varyings { float4 position : SV_Position; float2 uv : TEXCOORD0; };
struct Output { float4 color : SV_Target0; ${mesh ? "float depth : SV_Depth;" : ""} };
[shader("vertex")] Varyings vertices(${mesh ? "[[vk::location(0)]] float3 position : POSITION" : "uint index : SV_VertexID"}) {
  ${mesh ? "float2 p = position.xy * 2; float z = position.z * 0.25 + 0.5;" : "float2 triangle[3] = {float2(-1,-1),float2(3,-1),float2(-1,3)}; float2 p = triangle[index]; float z = 0.5;"}
  Varyings output; output.position = float4(p,z,1); output.uv = p * 0.5 + 0.5; return output;
}
[shader("fragment")] Output image(Varyings input) {
  ${mesh ? "float3 value = float3(input.uv, input.position.z);" : "float2 value = input.uv;"}
  Output output; output.color = float4(value.xy,0.1,1); ${mesh ? "output.depth = input.position.z;" : ""} return output;
}`;
}

describe("native raster debugging", () => {
  for (const language of ["wgsl", "slang"] as const) {
    it.each([false, true])(`${language} captures actual interpolants and structured depth outputs (mesh=%s)`, { timeout: 30000 }, async mesh => {
      const source = sourceFor(language, mesh);
      const path = `/native-raster.${language}`;
      const config: ShaderConfig = { version: "1.0", passes: { Image: { entryPoints: { vertex: "vertices", fragment: "image" }, ...(mesh ? { geometry: { type: "cube" } } : {}) } } };
      const harness = createShaderCanvasHarness(language);
      try {
        harness.resize(4, 4);
        await harness.compile({ image: source, path, config });
        const original = await harness.renderAndReadPixels();
        expect(original.every(pixel => pixel[2] === 26 && pixel[3] === 255)).toBe(true);
        const workspace: DebugWorkspace = { rootUri: path, rootPath: path, passName: "Image", render: { entryPoint: "image" }, contentHash: "abcd1234", files: [{ uri: path, path, source, version: 1, moduleName: "", ownerPass: "Image" }] };
        const request = { workspace, sourceUri: path, position: { line: 7, character: 2 } };
        const debug = language === "wgsl" ? new WgslDebugEngine() : new SlangDebugEngine();
        const analysis = debug.analyze(request);
        if (!analysis.ok) {
          throw new Error(analysis.diagnostics[0]?.message);
        }
        const value = analysis.analysis.visibleValues.find(candidate => candidate.name === "value")!;
        expect(value).toBeDefined();
        const plan = debug.planCapture(request, [value.id]);
        if (!plan.ok) {
          throw new Error(plan.diagnostics[0]?.message);
        }
        const preview = debug.planPreview(request, { normalizeMode: "off", stepEdge: null });
        if (!preview.ok) {
          throw new Error(preview.diagnostics[0]?.message);
        }
        expect(await harness.engine.compileDebugPlan?.(preview.plan, config)).toMatchObject({ success: true });
        const previewPixels = await harness.renderAndReadPixels();
        expect(previewPixels.map(pixel => pixel.slice(0, 2))).toEqual(original.map(pixel => pixel.slice(0, 2)));
        expect(previewPixels.every(pixel => pixel[2] === (mesh ? 64 : 0))).toBe(true);
        await harness.compile({ image: source, path, config });
        const capturer = harness.engine.createVariableCapturer();
        try {
          capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(source, "Image", path));
          const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: plan.plan.files[0]!.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
          const issued = await capturer.issueCaptureAtPixel(captures, 1, 0, 4, 4, harness.engine.getCaptureUniforms());
          expect({ issued, error: capturer.getLastError() }).toEqual({ issued: captures.length, error: null });
          const pixel = await collect(capturer, captures.length);
          expect([...pixel.find(result => result.varName === "value")!.rgba]).toEqual([0.375, 0.875, mesh ? 0.25 : 0, 1]);
          expect(pixel.find(result => result.hidden)!.rgba[0]).toBe(1);
          expect(await capturer.issueCaptureGrid(captures, harness.engine.getCaptureUniforms(), 2, 2)).toBe(captures.length);
          const grid = await collect(capturer, captures.length);
          expect([...grid.find(result => result.varName === "value")!.rgba]).toEqual([0.375,0.625,mesh ? 0.25 : 0,1, 0.875,0.625,mesh ? 0.25 : 0,1, 0.375,0.125,mesh ? 0.25 : 0,1, 0.875,0.125,mesh ? 0.25 : 0,1]);
          expect(capturer.getLastError()).toBeNull();
        } finally {
          capturer.dispose();
        }
        expect(await harness.renderAndReadPixels()).toEqual(original);
      } finally {
        harness.dispose();
      }
    });
  }
});
