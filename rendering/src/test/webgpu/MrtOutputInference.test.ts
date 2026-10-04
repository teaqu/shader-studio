import { describe, expect, it } from 'vitest';
import { resolveRenderOutputs } from '../../webgpu/MrtPassConfig';
import { buildSlangPassGraph } from '../../webgpu/SlangPassGraph';

const code = `struct Result { @location(0) colour: vec4f, @location(1) normal: vec4f }
  @fragment fn draw() -> Result { return Result(); }`;
describe('render output inference', () => {
  it('allocates and routes outputs without an explicit output count', () => {
    const graph = buildSlangPassGraph({ imageCode: 'fn mainImage() {}', buffers: { BufferA: code }, canvasWidth: 32, canvasHeight: 32, language: 'wgsl',
      config: { version: '1.0', passes: { BufferA: { path: 'a.wgsl', entryPoints: { fragment: 'draw' } }, Image: { inputs: { iChannel0: { type: 'buffer', source: 'BufferA', output: 1 } } } } } });
    expect(graph.errors).toEqual([]);
    expect(graph.passes.find(pass => pass.name === 'BufferA')?.outputCount).toBe(2);
  });
  it('keeps legacy labels while code determines count', () => {
    const errors: string[] = [];
    const outputs = resolveRenderOutputs([['BufferA', { path: 'a.wgsl', entryPoints: { fragment: 'draw' }, outputs: [{ name: 'Beauty' }] }]], 'wgsl', errors, { BufferA: code });
    expect(errors).toEqual([]);
    expect(outputs.get('BufferA')).toEqual({ count: 2, outputs: [{ name: 'Beauty' }, { name: 'normal' }] });
  });
  it('reports incomplete output declarations and stale routes', () => {
    const graph = buildSlangPassGraph({ imageCode: '', buffers: { BufferA: '@fragment fn draw() {' }, canvasWidth: 32, canvasHeight: 32, language: 'wgsl',
      config: { version: '1.0', passes: { BufferA: { path: 'a.wgsl', entryPoints: { fragment: 'draw' } }, Image: { inputs: { iChannel0: { type: 'buffer', source: 'BufferA', output: 1 } } } } } });
    expect(graph.errors.some(error => error.includes('incomplete'))).toBe(true);
    expect(graph.errors.some(error => error.includes('output 1'))).toBe(true);
  });
});
