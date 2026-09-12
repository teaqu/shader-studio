import { describe, expect, it } from 'vitest';
import { wrapWgslComputeSource, wrapWgslImageSource } from '../../webgpu/WgslPrelude';

const channels = [{ key: 'albedo', slot: 0 }];
describe('WGSL channel contract', () => {
  it('exposes direct metadata and native handles with shared helpers', () => {
    const { source } = wrapWgslImageSource('fn mainImage(c: vec2f) -> vec4f { return vec4f(1); }', { channels });
    expect(source).toContain('var<private> albedo:');
    expect(source).toContain('var albedoTexture: texture_2d<f32>');
    expect(source).toContain('var albedoSampler: sampler');
    expect(source).toContain('fn sample2DLevel(');
    expect(source).toContain('albedo.time = _ss_u.channelTime[0].x');
    expect(source).toContain('_ss_initChannels();');
  });
  it('does not substitute LOD zero for implicit compute sampling', () => {
    const { source } = wrapWgslComputeSource('@compute @workgroup_size(1) fn update() {}', {
      channels, workgroupSize: [1,1,1], outputLayers: 1, hasOutput: false,
    });
    expect(source).not.toContain('fn albedoSample(');
    expect(source).not.toContain('fn sample2D(');
    expect(source).toContain('fn sample2DLevel(');
    expect(source).toContain('fn sample2DGrad(');
  });
});

describe('WGSL resource alias linking', () => {
  const shared = [
    { key: 'a', slot: 0, textureIdentity: 'shared', samplerIdentity: 'shared' },
    { key: 'longer', slot: 1, textureIdentity: 'shared', samplerIdentity: 'shared' },
  ];
  it('preserves local shadowing, fields, comments and all source positions', () => {
    const user = `struct Value { longerTexture: f32 }
fn local(longerTexture: f32) -> f32 { return longerTexture; }
fn mainImage(c: vec2f) -> vec4f {
  // longerTexture longerSampler
  let value = Value(1.0);
  let sampled = sample2DLevel(longerTexture, longerSampler, c, 0);
  return sampled * value.longerTexture * local(1.0);
}`;
    const result = wrapWgslImageSource(user, { channels: shared });
    const assembledUser = result.source.split('\n').slice(result.preludeLineCount, result.preludeLineCount + user.split('\n').length).join('\n');
    expect(assembledUser).toBe(user.replace('sample2DLevel(longerTexture, longerSampler', 'sample2DLevel(aTexture     , aSampler     '));
    expect(assembledUser.length).toBe(user.length);
    expect(result.source.match(/@binding\(1\) var/g)).toHaveLength(1);
    expect(result.source.match(/@binding\(2\) var/g)).toHaveLength(1);
  });
});
