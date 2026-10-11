import { describe, expect, it } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import { resolveRenderOutputs } from '../../webgpu/MrtPassConfig';

type Pass = ShaderConfig['passes'][string];
describe('legacy render output validation', () => {
  it.each([
    ['Image', { outputs: [{}] }, 'wgsl', 'only on buffer passes'],
    ['ComputeA', { type: 'compute', outputs: [{}] }, 'wgsl', 'compute passes use outputLayers'],
    ['BufferA', { outputs: [] }, 'wgsl', 'non-empty list'],
    ['BufferA', { outputs: Array(9).fill({}) }, 'wgsl', 'at most 8'],
    ['BufferA', { outputs: [null] }, 'wgsl', 'named render targets'],
    ['BufferA', { outputs: [[]] }, 'wgsl', 'named render targets'],
    ['BufferA', { outputs: [{ other: 'unexpected' }] }, 'wgsl', 'named render targets'],
    ['BufferA', { outputs: [{ name: '' }] }, 'wgsl', 'named render targets'],
    ['BufferA', { outputs: [{ name: 1 }] }, 'wgsl', 'named render targets'],
    ['BufferA', { outputs: [{}, {}], entryPoints: {} }, 'glsl', 'GLSL MRT is not supported'],
    ['BufferA', { outputs: [{}, {}] }, 'slang', 'require native render entryPoints'],
  ] as const)('rejects invalid legacy targets: %s %j', (name, pass, language, error) => {
    const errors: string[] = [];
    expect(resolveRenderOutputs([[name, pass as unknown as Pass]], language, errors).size).toBe(0);
    expect(errors).toEqual([expect.stringContaining(error)]);
  });

  it('retains names for valid native targets and omits absent labels', () => {
    const errors: string[] = [];
    const outputs = resolveRenderOutputs([
      ['BufferA', { path: 'a.wgsl', outputs: [{ name: 'Colour' }, { name: 'Normal' }], entryPoints: {} }],
      ['BufferB', { path: 'b.wgsl', outputs: [{}] }],
      ['BufferC', { path: 'c.wgsl' }],
    ], 'wgsl', errors);
    expect(errors).toEqual([]);
    expect(outputs.get('BufferA')).toEqual({ count: 2, outputs: [{ name: 'Colour' }, { name: 'Normal' }] });
    expect(outputs.get('BufferB')).toEqual({ count: 1 });
    expect(outputs.has('BufferC')).toBe(false);
  });
});
