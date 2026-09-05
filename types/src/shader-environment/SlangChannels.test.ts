import { describe, expect, it } from 'vitest';
import { buildSlangAuthoringModule } from './SlangEnvironmentGenerator';

function generate(resources: Array<{ name: string; kind: 'texture-2d' | 'texture-cube'; slot?: number }>) {
  return buildSlangAuthoringModule({
    documentUri: 'file:///test.slang', languageId: 'slang', generation: 1,
    passName: 'Image', stage: 'fragment', customUniforms: [], virtualFiles: [], resources,
  }).text;
}

describe('Slang named channel API', () => {
  it('groups configured resources and metadata without exposing legacy aliases', () => {
    const source = generate([{ name: 'iChannel0', kind: 'texture-2d' }, { name: 'sky', kind: 'texture-cube' }]);
    expect(source).toContain('ShaderStudioChannel2D iChannel0');
    expect(source).toContain('ShaderStudioChannelCube sky');
    expect(source).toContain('ShaderStudioInputs inputs');
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
});
