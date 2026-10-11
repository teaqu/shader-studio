import { expect, it } from "vitest";
import { WgslDebugEngine } from "@shader-studio/debug";
import type { DebugWorkspace, ShaderConfig } from "@shader-studio/types";
import type { CaptureResult, IVariableCapturer } from "../../capture/VariableCapturer";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

async function collect(capturer: IVariableCapturer, count: number): Promise<CaptureResult[]> {
  const collected: CaptureResult[] = [];
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    collected.push(...capturer.collectResults());
    if (collected.length >= count) {
      return collected;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(capturer.getLastError() ?? "Native vertex hook capture did not resolve");
}

it("captures a mainImage local through a selected native vertex stage", { timeout: 30_000 }, async () => {
  const path = "/native-vertex-hook.wgsl";
  const source = `struct Varyings { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) worldPosition: vec3f, @location(2) normal: vec3f, }
@vertex fn cameraVertex(@builtin(vertex_index) index: u32) -> Varyings {
  let triangle = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  let point = triangle[index];
  return Varyings(vec4f(point, 0, 1), point * 0.5 + 0.5, vec3f(point, 0), vec3f(0, 0, 1));
}
fn mainImage(coord: vec2f) -> vec4f {
  let value = vec4f(coord / iResolution.xy, 0.2, 1.0);
  return value;
}`;
  const config: ShaderConfig = { version: "1.0", passes: { Image: { entryPoints: { vertex: "cameraVertex" } } } };
  const harness = createShaderCanvasHarness("wgsl");
  try {
    harness.resize(4, 4);
    await harness.compile({ path, image: source, config });
    const original = await harness.renderAndReadPixels();
    const workspace: DebugWorkspace = { rootUri: path, rootPath: path, passName: "Image", contentHash: "native-vertex-hook", files: [{ uri: path, path, source, version: 1, moduleName: "", ownerPass: "Image" }] };
    const request = { workspace, sourceUri: path, position: { line: 7, character: 4 } };
    const debug = new WgslDebugEngine();
    const analysis = debug.analyze(request);
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0]?.message);
    }
    const value = analysis.analysis.visibleValues.find(candidate => candidate.name === "value");
    expect(value).toBeDefined();
    const plan = debug.planCapture(request, [value!.id]);
    if (!plan.ok) {
      throw new Error(plan.diagnostics[0]?.message);
    }
    const capturer = harness.engine.createVariableCapturer();
    try {
      capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(source, "Image", path));
      const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: plan.plan.files[0]!.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
      expect({ issued: await capturer.issueCaptureAtPixel(captures, 1, 0, 4, 4, harness.engine.getCaptureUniforms()), error: capturer.getLastError() })
        .toEqual({ issued: captures.length, error: null });
      const captured = (await collect(capturer, captures.length)).find(result => result.varName === "value")!;
      expect([...captured.rgba]).toEqual([0.375, 0.875, expect.closeTo(0.2, 6), 1]);
    } finally {
      capturer.dispose();
    }
    expect(await harness.renderAndReadPixels()).toEqual(original);
  } finally {
    harness.dispose();
  }
});
