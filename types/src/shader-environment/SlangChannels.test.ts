import { buildSlangChannels, buildWgslChannelAuthoringSource } from './SlangChannels';
import { describe, expect, it } from 'vitest';
import { buildSlangAuthoringModule } from './SlangEnvironmentGenerator';

function generate(resources: Array<{ name: string; kind: 'texture-2d' | 'texture-cube'; slot?: number }>) {
  return buildSlangAuthoringModule({
    documentUri: 'file:///test.slang', languageId: 'slang', generation: 1,
    passName: 'Image', stage: 'fragment', customUniforms: [], virtualFiles: [], resources,
  }).text;
}

describe('Slang named channel API', () => {
  it('emits direct channel globals with metadata and no inputs container', () => {
    const source = buildSlangChannels([
      { name: 'a', slot: 0, kind: 'texture-2d' },
      { name: 'b', slot: 7, kind: 'texture-2d' },
    ], { runtime: true, bindings: [
      { slot: 0, textureBinding: 1, samplerBinding: 2 },
      { slot: 7, textureBinding: 1, samplerBinding: 2 },
    ] });
    expect(source.match(/\[\[vk::binding/g)).toHaveLength(2);
    expect(source).toContain('property ShaderStudioChannel2D a');
    expect(source).toContain('property ShaderStudioChannel2D b');
    expect(source).not.toContain('ShaderStudioInputs');
    expect(source).not.toContain('static ShaderStudioChannel');
    expect(source).toContain('_st.channelResolution[7]');
    const textures = [...source.matchAll(/result.texture = (\w+);/g)].map(match => match[1]);
    const samplers = [...source.matchAll(/result.sampler = (\w+);/g)].map(match => match[1]);
    expect(textures).toHaveLength(2);
    expect(textures[0]).toBe(textures[1]);
    expect(samplers[0]).toBe(samplers[1]);
  });

  it('groups configured resources and metadata without exposing an inputs namespace', () => {
    const source = generate([{ name: 'iChannel0', kind: 'texture-2d' }, { name: 'sky', kind: 'texture-cube' }]);
    expect(source).toContain('ShaderStudioChannel2D iChannel0');
    expect(source).toContain('ShaderStudioChannelCube sky');
    expect(source).not.toContain('ShaderStudioInputs');
    expect(source).not.toContain('static ShaderStudioInputs inputs');
    expect(source).toContain('bool loaded;');
    expect(source).toContain('uint2 size;');
    expect(source).toContain('float4 SampleLevel(float2 uv, float lod)');
    expect(source).toContain('float4 SampleGrad(float3 dir, float3 dx, float3 dy)');
    expect(source).toContain('SamplerState sampler;');
    expect(source).not.toMatch(/\biCh\d|\biChannel(?:Resolution|Time|Loaded)|\bsampleIChannel|\bsampleSky/);
  });

  it('does not invent resources for missing slots', () => {
    const source = generate([]);
    expect(source).not.toContain('channel0');
    expect(source).not.toContain('sampleIChannel');
  });

  it('keeps the configured name independent of binding order', () => {
    const source = generate([{ name: 'iChannel7', kind: 'texture-2d', slot: 1 }]);
    expect(source).toContain('ShaderStudioChannel2D iChannel7');
    expect(source).not.toContain('ShaderStudioChannel2D iChannel1');
  });

  it('generates bottom-left integer load helpers without a sampler', () => {
    const slang = buildSlangChannels([{ name: 'state', slot: 0, kind: 'texture-2d' }]);
    expect(slang).toContain('float4 load2D(Texture2D<float4> texture, int2 pixel)');
    expect(slang).toContain('int(height) - 1 - pixel.y');
    expect(slang).toContain('float4 Load(int2 pixel)');

    const wgsl = buildWgslChannelAuthoringSource([{ name: 'state', slot: 0, kind: 'texture-2d' }], true);
    expect(wgsl).toContain('fn load2D(texture: texture_2d<f32>, pixel: vec2i)');
    expect(wgsl).toContain('i32(size.y) - 1 - pixel.y');
    expect(wgsl).toContain('fn stateLoad(pixel: vec2i)');
  });
});
