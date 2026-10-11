import { expect, it } from 'vitest';
import { SlangDebugEngine } from '../../../../debug/src';
import type { CaptureResult, IVariableCapturer } from '../../capture/VariableCapturer';
import { createShaderCanvasHarness } from './ShaderCanvasHarness';

async function collect(capturer: IVariableCapturer): Promise<CaptureResult> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const result = capturer.collectResults().find(value => value.varName === 'value');
    if (result) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(capturer.getLastError() ?? 'Unsigned Slang capture did not resolve');
}

it.each([
  ['uint', '2147483648u', [2147483648, 2147483648, 2147483648, 1]],
  ['uint2', 'uint2(3u, 7u)', [3, 7, 0, 1]],
] as const)('captures %s numerically without signed conversion or component reordering', { timeout: 30_000 }, async (type, initializer, expected) => {
  const path = '/unsigned.slang';
  const source = `float4 mainImage(float2 p) {
  ${type} value = ${initializer};
  return float4(0.2, 0.4, 0.6, 1);
}`;
  const request = { workspace: { rootUri: path, rootPath: path, passName: 'Image', contentHash: source,
    files: [{ uri: path, path, source, version: 1, moduleName: '', ownerPass: 'Image' }] },
  sourceUri: path, position: { line: 1, character: 2 } };
  const debug = new SlangDebugEngine();
  const analysis = debug.analyze(request);
  expect(analysis.ok).toBe(true);
  if (!analysis.ok) {
    throw new Error(analysis.diagnostics[0]?.message);
  }
  const value = analysis.analysis.visibleValues.find(value => value.name === 'value');
  expect(value?.typeName).toBe(type);
  const plan = debug.planCapture(request, [value!.id]);
  expect(plan.ok).toBe(true);
  if (!plan.ok) {
    throw new Error(plan.diagnostics[0]?.message);
  }
  const harness = createShaderCanvasHarness('slang');
  try {
    await harness.compile({ path, image: source });
    const original = await harness.renderAndReadPixels();
    const capturer = harness.engine.createVariableCapturer();
    try {
      capturer.setCompileContext(harness.engine.getVariableCaptureCompileContext(source, 'Image', path));
      const captures = plan.plan.captureSlots.map(slot => ({ varName: slot.name, varType: slot.typeName,
        captureShader: plan.plan.files[0]!.source, selectorIndex: slot.index, hidden: slot.hidden, debugPlan: plan.plan }));
      expect({ issued: await capturer.issueCaptureAtPixel(captures, 0, 0, 2, 2, harness.engine.getCaptureUniforms()), error: capturer.getLastError() })
        .toEqual({ issued: captures.length, error: null });
      expect([...(await collect(capturer)).rgba]).toEqual(expected);
    } finally {
      capturer.dispose();
    }
    expect(await harness.renderAndReadPixels()).toEqual(original);
  } finally {
    harness.dispose();
  }
});
