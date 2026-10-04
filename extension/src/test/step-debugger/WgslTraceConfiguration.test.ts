import * as assert from 'assert';
import { createWgslTraceDebugConfiguration } from '../../step-debugger/WgslTraceConfiguration';

suite('WGSL trace from pixel inspector', () => {
  const payload = { program: '/image.wgsl', source: 'fn mainImage(p: vec2f) -> vec4f { return vec4f(1); }',
    width: 64, height: 48, pixel: [12, 9], time: 2.5, frame: 13, capacity: 4096,
    customUniforms: [{ name: 'gain', type: 'float', value: 0.25 }],
    uniforms: { mouse: [1, 2, 3, 4], date: [2026, 10, 3, 100], frameRate: 60, timeDelta: 0.1 } };

  test('preserves the selected pixel and frozen preview inputs in a WGSL launch', () => {
    assert.deepStrictEqual(createWgslTraceDebugConfiguration(payload), { ...payload,
      type: 'shader-studio-wgsl-trace', request: 'launch', name: 'Trace inspected WGSL pixel (12, 9)' });
  });

  test('starts a supplied project recording without creating a second GPU runner', () => {
    const recording = { path: payload.program, source: payload.source, sources: [{ path: payload.program, source: payload.source }],
      sites: [{ id: 0, line: 1, column: 1, variables: [] }], events: [{ siteId: 0, line: 1, column: 1, values: [] }],
      overflow: false, color: [1, 1, 1, 1] };
    const configuration = createWgslTraceDebugConfiguration({ program: payload.program, source: payload.source, recording });
    assert.deepStrictEqual(configuration.recording, recording);
    assert.strictEqual(configuration.type, 'shader-studio-wgsl-trace');
  });

  test('refuses missing, malformed and out-of-bounds requests', () => {
    for (const invalid of [null, undefined, [], {}, { ...payload, source: undefined },
      { ...payload, program: '/image.glsl' }, { ...payload, pixel: [64, 0] },
      { ...payload, uniforms: { mouse: [1, 2] } }, { ...payload, customUniforms: [{ name: 'gain', type: 'float', value: NaN }] }]) {
      assert.throws(() => createWgslTraceDebugConfiguration(invalid));
    }
  });

  test('ignores supplied debugger identity fields', () => {
    const config = createWgslTraceDebugConfiguration({ ...payload, type: 'other', request: 'attach', name: 'other' });
    assert.strictEqual(config.type, 'shader-studio-wgsl-trace');
    assert.strictEqual(config.request, 'launch');
  });
});
