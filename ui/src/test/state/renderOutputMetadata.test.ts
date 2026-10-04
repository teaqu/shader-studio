import { describe, expect, it } from 'vitest';
import { discoverRenderOutputs, getRenderOutputMetadata, setRenderOutputMetadata } from '../../lib/state/renderOutputMetadata.svelte';

describe('render output metadata', () => {
  it('combines common declarations with the selected pass and keeps labels by slot', () => {
    const config = { version: '1.0', passes: { Image: {}, common: { path: 'common.wgsl' }, BufferA: { path: 'a.wgsl', entryPoints: { fragment: 'shade' }, outputs: [{ name: 'Beauty' }] }, ComputeA: { type: 'compute' as const, path: 'compute.wgsl' } } };
    const result = discoverRenderOutputs(config, 'wgsl', name => name === 'common' ? 'struct R { @location(0) colour: vec4f, @location(1) normal: vec4f, }' : '@fragment fn shade() -> R { return R(); }');
    expect(result).toEqual({ BufferA: { outputs: [{ slot: 0, name: 'Beauty' }, { slot: 1, name: 'normal' }] } });
    setRenderOutputMetadata('one', result);
    expect(getRenderOutputMetadata('one')).toEqual(result);
    expect(getRenderOutputMetadata('two')).toEqual({});
  });
  it('replaces stale metadata with a discovery error and zero slots', () => {
    const result = discoverRenderOutputs({ version: '1.0', passes: { Image: {}, BufferA: { path: 'a.wgsl', entryPoints: { fragment: 'gone' } } } }, 'wgsl', () => '');
    setRenderOutputMetadata('one', result);
    expect(getRenderOutputMetadata('one').BufferA.outputs).toEqual([]);
    expect(getRenderOutputMetadata('one').BufferA.error).toContain('missing');
  });
});
