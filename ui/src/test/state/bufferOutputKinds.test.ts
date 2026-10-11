import { describe, expect, it } from 'vitest';
import { getBufferOutputKind, setBufferOutputKinds } from '../../lib/state/bufferOutputKinds.svelte';

describe('buffer output kinds', () => {
  it('tracks render and compute cubes per shader and clears stale config', () => {
    setBufferOutputKinds('one', { version: '1.0', passes: {
      Image: {},
      Sky: { path: 'sky.slang', outputKind: 'cubemap' },
      Compute: { type: 'compute', path: 'compute.slang', outputKind: 'cubemap' },
      Flat: { path: 'flat.slang' },
    } });
    expect(getBufferOutputKind('one', 'Sky')).toBe('cubemap');
    expect(getBufferOutputKind('one', 'Compute')).toBe('cubemap');
    expect(getBufferOutputKind('one', 'Flat')).toBe('2d');
    expect(getBufferOutputKind('one', 'missing')).toBe('2d');
    expect(getBufferOutputKind('two', 'Sky')).toBe('2d');
    setBufferOutputKinds('one', null);
    expect(getBufferOutputKind('one', 'Sky')).toBe('2d');
  });
});
