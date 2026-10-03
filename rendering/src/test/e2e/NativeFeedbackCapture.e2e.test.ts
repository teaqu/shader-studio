import { expect, it } from "vitest";
import { SlangDebugEngine, WgslDebugEngine } from "@shader-studio/debug";
import type { DebugWorkspace, ShaderConfig } from "@shader-studio/types";
import type { CaptureResult, IVariableCapturer } from "../../capture/VariableCapturer";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

async function collect(capturer: IVariableCapturer, count: number): Promise<CaptureResult[]> {
  const end = performance.now() + 5000;
  const results: CaptureResult[] = [];
  while (performance.now() < end) {
    results.push(...capturer.collectResults());
    if (results.length === count) {
      return results;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(capturer.getLastError() ?? "feedback capture timed out");
}

function sources(language: "wgsl" | "slang"): { image: string; buffer: string } {
  if (language === "wgsl") {
    return {
      image: "fn mainImage(coord: vec2f) -> vec4f { return iChannel0Sample(coord / iResolution.xy); }",
      buffer: `@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p=array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
@fragment fn fragment(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let value = iChannel0Sample(p.xy / iResolution.xy).r + 0.2;
  let frameValue = f32(iFrame); return vec4f(value, frameValue / 10.0, 0, 1);
}`,
    };
  }
  return {
    image: "float4 mainImage(float2 coord) { return iChannel0.Sample(coord / iResolution.xy); }",
    buffer: `[shader("vertex")] float4 vertex(uint i : SV_VertexID) : SV_Position { float2 p[3]={float2(-1,-1),float2(3,-1),float2(-1,3)}; return float4(p[i],0,1); }
[shader("fragment")] float4 fragment(float4 p : SV_Position) : SV_Target0 {
  float4 value = float4(iChannel0.Sample(p.xy / iResolution.xy).r + 0.2, 0, 0, 1);
  float frameValue = float(iFrame); return float4(value.r, frameValue / 10.0, 0, 1);
}`,
  };
}

it.each(["wgsl", "slang"] as const)("captures frozen frame-two feedback in %s", { timeout: 30000 }, async language => {
  const { image, buffer } = sources(language);
  const imagePath = `/feedback/image.${language}`;
  const bufferPath = `/feedback/buffer.${language}`;
  const config: ShaderConfig = { version: "1.0", passes: {
    Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
    BufferA: { path: bufferPath, entryPoints: { vertex: "vertex", fragment: "fragment" }, inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
  } };
  const harness = createShaderCanvasHarness(language);
  try {
    await harness.compile({ path: imagePath, image, buffers: { BufferA: buffer }, config });
    await harness.renderAndReadPixels();
    const frameTwo = await harness.renderAndReadPixels();
    expect(frameTwo[0]![0]).toBeCloseTo(102, -1);
    const workspace: DebugWorkspace = { rootUri: bufferPath, rootPath: bufferPath, passName: "BufferA", render: { entryPoint: "fragment" }, contentHash: `feedback-${language}`, channels: [{ name: "iChannel0", slot: 0, kind: "texture-2d" }], files: [{ uri: bufferPath, path: bufferPath, source: buffer, version: 1, moduleName: "", ownerPass: "BufferA" }] };
    const valueLine = buffer.split("\n").findIndex(line => line.includes(" value ="));
    const valueText = buffer.split("\n")[valueLine]!;
    const request = { workspace, sourceUri: bufferPath, position: { line: valueLine + 1, character: 4 } };
    const debug = language === "wgsl" ? new WgslDebugEngine() : new SlangDebugEngine();
    const analysis = debug.analyze(request);
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0]?.message);
    }
    const value = analysis.analysis.visibleValues.find(item => item.name === "value")!;
    const frameValue = analysis.analysis.visibleValues.find(item => item.name === "frameValue")!;
    const plan = debug.planCapture(request, [value.id, frameValue.id]);
    if (!plan.ok) {
      throw new Error(plan.diagnostics[0]?.message);
    }
    const capturer = harness.engine.createVariableCapturer();
    try {
      capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(buffer, "BufferA", bufferPath));
      const root = plan.plan.files.find(file => file.uri === plan.plan.rootUri)!;
      const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: root.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
      expect(await capturer.issueCaptureAtPixel(captures, 0, 0, 2, 2, harness.engine.getCaptureUniforms())).toBe(captures.length);
      const captured = await collect(capturer, captures.length);
      expect(captured.find(result => result.varName === "value")!.rgba[0]).toBeCloseTo(.4, 4);
      expect(captured.find(result => result.varName === "frameValue")!.rgba[0]).toBeCloseTo(1, 4);
    } finally {
      capturer.dispose();
    }
    const frameThree = await harness.renderAndReadPixels();
    expect(frameThree[0]![0]).toBeCloseTo(153, -1);
  } finally {
    harness.dispose();
  }
});
