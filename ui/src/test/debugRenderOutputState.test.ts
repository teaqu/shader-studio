import { describe, expect, it } from 'vitest';
import { resolveRenderOutputState } from '../lib/debugRenderOutputState';

describe('resolveRenderOutputState', () => {
  it('labels configured outputs and clamps a stale selection', () => {
    expect(resolveRenderOutputState({ path: 'a.wgsl', outputs: [{ name: 'colour' }, {}, { name: 'normal' }] }, 9))
      .toEqual({ renderOutput: 2, renderOutputs: ['Output 0 (colour)', 'Output 1', 'Output 2 (normal)'] });
  });
});
