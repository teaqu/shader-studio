import { describe, expect, it } from 'vitest';
import type { DebugAnalysisRequest } from '@shader-studio/types';
import { WgslDebugEngine } from '../WgslDebugEngine';

function request(compute = false, common = false): DebugAnalysisRequest {
  const source = compute ? '@compute @workgroup_size(1) fn update() {\n  let shade = values[0];\n}'
    : 'fn mainImage(p: vec2f) -> vec4f {\n  let shade = values[0];\n  return vec4f(shade);\n}';
  return { workspace: {
    rootUri: '/image.wgsl', rootPath: '/image.wgsl', passName: compute ? 'Compute' : 'Image', contentHash: '1234abcd',
    storage: { values: { elementType: 'f32' } },
    ...(compute ? { compute: { entryPoint: 'update', storageNames: ['values'] } } : {}),
    files: [
      { uri: '/image.wgsl', path: '/image.wgsl', source: common ? 'fn mainImage(p: vec2f) -> vec4f { return vec4f(helper()); }' : source, version: 1, moduleName: '', ownerPass: 'Image' },
      ...(common ? [{ uri: '/common.wgsl', path: '/common.wgsl', source: 'fn helper() -> f32 {\n  let shade = values[0];\n  return shade;\n}', version: 1, moduleName: '', ownerPass: 'Image' }] : []),
    ],
  }, sourceUri: common ? '/common.wgsl' : '/image.wgsl', position: { line: 1, character: 2 } };
}

describe('WGSL storage-backed captures', () => {
  it.each([[false, false], [true, false], [false, true]])('infers storage locals in compute=%s Common=%s without emitting duplicate storage declarations', (compute, common) => {
    const input = request(compute, common);
    const engine = new WgslDebugEngine();
    const analysis = engine.analyze(input);
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) {
      throw new Error('analysis failed');
    }
    const shade = analysis.analysis.visibleValues.find(value => value.name === 'shade');
    expect(shade).toMatchObject({ typeName: 'f32', sourceUri: input.sourceUri, declarationRange: { start: { line: 1, character: 6 } } });
    const plan = engine.planCapture(input, [shade!.id]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      throw new Error(plan.diagnostics[0]?.message);
    }
    expect(plan.plan.captureSlots).toContainEqual(expect.objectContaining({ name: 'shade', typeName: 'f32', hidden: false }));
    expect(plan.plan.selectedSourceUri).toBe(input.sourceUri);
    expect(plan.plan.files.map(file => file.source).join('\n')).not.toContain('var<storage');
    expect(plan.plan.files.find(file => file.uri === input.sourceUri)?.source).toContain('_slot1 = shade;');
  });

  it('preserves the compute storage-write restriction with configured types', () => {
    const input = request(true);
    input.workspace.files[0].source = '@compute @workgroup_size(1) fn update() {\n  let shade = values[0];\n  values[0] = shade;\n}';
    expect(new WgslDebugEngine().planPreview(input, { normalizeMode: 'off', stepEdge: null })).toMatchObject({
      ok: false, diagnostics: [{ code: 'wgsl-debug-unsupported-syntax', message: expect.stringContaining('writes to configured storage') }],
    });
  });
});

it('captures an inferred array/struct scalar in the innermost helper scope', () => {
  const input = request();
  input.workspace.files[0].source = `struct Sample { value: f32, }
fn helper(gain: f32) -> f32 {
  let samples = array<Sample, 2>(Sample(0.125), Sample(gain));
  var shade = 0.125;
  if (gain > 0.0) {
    let shade = samples[1].value;
    return shade;
  }
  return shade;
}
fn mainImage(p: vec2f) -> vec4f { return vec4f(helper(0.375)); }`;
  input.position = { line: 5, character: 4 };
  const engine = new WgslDebugEngine();
  const analysis = engine.analyze(input);
  if (!analysis.ok) {
    throw new Error(JSON.stringify(analysis));
  }
  expect(analysis.analysis.containingCallable.name).toBe('helper');
  expect(analysis.analysis.visibleValues.filter(value => value.name === 'shade')).toMatchObject([
    { typeName: 'f32', declarationRange: { start: { line: 5 } } },
  ]);
  const result = engine.planCapture(input, [analysis.analysis.previewValueId!]);
  if (!result.ok) {
    throw new Error(JSON.stringify(result));
  }
  expect(result.plan.files[0].source).toMatch(/let shade = samples\[1\]\.value;\s+\w+_executed = true;\s+\w+_slot1 = shade;/);
});
