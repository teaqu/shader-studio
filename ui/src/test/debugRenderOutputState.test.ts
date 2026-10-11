import { describe, expect, it } from 'vitest';
import { resolveRenderOutputState } from '../lib/debugRenderOutputState';

describe('resolveRenderOutputState', () => {
  it('labels configured outputs and clamps a stale selection', () => {
    expect(resolveRenderOutputState({ path: 'a.wgsl', outputs: [{ name: 'colour' }, {}, { name: 'normal' }] }, 9))
      .toEqual({ renderOutput: 2, renderOutputs: ['Output 0 (colour)', 'Output 1', 'Output 2 (normal)'] });
  });
  it('infers debug choices from code without a configured output count', () => {
    const source = 'struct R { @location(0) colour: vec4f, @location(1) normal: vec4f, } @fragment fn shade() -> R { return R(); }';
    expect(resolveRenderOutputState({ path: 'a.wgsl', entryPoints: { fragment: 'shade' } }, 1, source, 'wgsl'))
      .toEqual({ renderOutput: 1, renderOutputs: ['Output 0 (colour)', 'Output 1 (normal)'] });
    expect(resolveRenderOutputState({ path: 'a.wgsl', entryPoints: { fragment: 'shade' } }, 1, '', 'wgsl').renderOutputs).toEqual([]);
  });
});
