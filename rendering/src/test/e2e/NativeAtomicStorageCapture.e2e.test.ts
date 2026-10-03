import { expect, it } from "vitest";
import { WgslDebugEngine } from "@shader-studio/debug";
import type { DebugWorkspace, ShaderConfig } from "@shader-studio/types";
import type { CaptureResult, IVariableCapturer } from "../../capture/VariableCapturer";
import { createShaderCanvasHarness } from "./ShaderCanvasHarness";

async function collect(capturer: IVariableCapturer): Promise<CaptureResult[]> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const results = capturer.collectResults();
    if (results.length > 0) {
      return results;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(capturer.getLastError() ?? "Atomic capture did not resolve");
}

it("runs native fragment atomic capture against a storage snapshot", { timeout: 30_000 }, async () => {
  const path = "/native-atomic/image.wgsl";
  const commonPath = "/native-atomic/common.wgsl";
  const common = "struct Counter { value: atomic<u32>, }";
  const source = `struct Varyings { @builtin(position) position: vec4f, }
@vertex fn vertices(@builtin(vertex_index) index: u32) -> Varyings {
  let p = array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return Varyings(vec4f(p[index], 0, 1));
}
@fragment fn fragment(input: Varyings) -> @location(0) vec4f {
  let previous = atomicAdd(&counter[0].value, 1u);
  let capturedValue = f32(previous);
  return vec4f(capturedValue / 8.0, input.position.xy * 0.0, 1.0);
}`;
  const config: ShaderConfig = { version: "1.0", storage: { counter: { count: 1, elementType: "Counter" } }, passes: {
    Image: { entryPoints: { vertex: "vertices", fragment: "fragment" } }, common: { path: commonPath },
  } };
  const harness = createShaderCanvasHarness("wgsl");
  try {
    harness.resize(2, 2);
    await harness.compile({ path, image: source, buffers: { common }, config });
    await harness.renderAndReadPixels();
    const before = new Uint32Array((await harness.engine.readStorageBuffer("counter", 0, 1)).data)[0];
    expect(before).toBe(4);
    const workspace: DebugWorkspace = {
      rootUri: path, rootPath: path, passName: "Image", render: { entryPoint: "fragment" }, storage: { counter: { elementType: "Counter" } }, contentHash: "native-atomic-storage",
      files: [{ uri: commonPath, path: commonPath, source: common, version: 1, moduleName: "", ownerPass: "Image" }, { uri: path, path, source, version: 1, moduleName: "", ownerPass: "Image" }],
    };
    const request = { workspace, sourceUri: path, position: { line: 7, character: 4 } };
    const debug = new WgslDebugEngine();
    const analysis = debug.analyze(request);
    if (!analysis.ok) {
      throw new Error(analysis.diagnostics[0]?.message);
    }
    const value = analysis.analysis.visibleValues.find(candidate => candidate.name === "capturedValue");
    expect(value).toBeDefined();
    const plan = debug.planCapture(request, [value!.id]);
    if (!plan.ok) {
      throw new Error(plan.diagnostics[0]?.message);
    }
    const capturer = harness.engine.createVariableCapturer();
    try {
      capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(source, "Image", path));
      const root = plan.plan.files.find(file => file.uri === path)!;
      const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName, captureShader: root.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
      expect({ issued: await capturer.issueCaptureAtPixel(captures, 0, 0, 2, 2, harness.engine.getCaptureUniforms()), error: capturer.getLastError() })
        .toEqual({ issued: captures.length, error: null });
      const captured = (await collect(capturer)).find(result => result.varName === "capturedValue")!;
      expect(captured.rgba[0]).toBeGreaterThanOrEqual(before);
    } finally {
      capturer.dispose();
    }
    const after = new Uint32Array((await harness.engine.readStorageBuffer("counter", 0, 1)).data)[0];
    expect(after).toBe(before);
  } finally {
    harness.dispose();
  }
});
