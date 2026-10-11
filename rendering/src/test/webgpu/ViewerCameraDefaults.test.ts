import { expect, it } from 'vitest';
import { buildSlangPassGraph } from '../../webgpu/SlangPassGraph';
import { resolveMeshSettings } from '../../webgpu/RenderPassGeometry';
import { ConfigValidator } from '../../util/ConfigValidator';

it.each([undefined, true, false])('inherits shader camera default %s and retains explicit pass overrides', shaderDefault => {
  for (const passDefault of [undefined, true, false]) {
    const expected = passDefault ?? shaderDefault;
    expect(resolveMeshSettings({ useViewerCamera: passDefault }, shaderDefault).useViewerCamera).toBe(expected);
    const graph = buildSlangPassGraph({ imageCode: 'float4 mainImage(float2 p) { return 1; }', buffers: { A: 'float4 mainImage(float2 p) { return 1; }' }, canvasWidth: 8, canvasHeight: 8,
      config: { version: '1.0', webgpu: { useViewerCamera: shaderDefault }, passes: {
        Image: { useViewerCamera: passDefault, geometry: { type: 'cube' } },
        A: { path: 'a.slang', useViewerCamera: passDefault, geometry: { type: 'model', path: 'a.glb' } },
      } } });
    expect(graph.errors).toEqual([]);
    expect(graph.passes.map(pass => pass.useViewerCamera)).toEqual([expected, expected]);
    expect(graph.passes[0]?.modelPath).toBe('a.glb');
  }
});

it('rejects invalid shader-wide camera defaults', () => {
  expect(ConfigValidator.validateConfig({ version: '1.0', webgpu: { useViewerCamera: 'false' as unknown as boolean }, passes: { Image: {} } })).toEqual({ isValid: false, errors: ['webgpu.useViewerCamera must be a boolean'] });
});
