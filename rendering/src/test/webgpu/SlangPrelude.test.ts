import { describe, expect, it } from 'vitest';
import { SHADER_STUDIO_BUILTIN_UNIFORMS } from '@shader-studio/types';
import { SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX, wrapSlangImageSource } from '../../webgpu/SlangPrelude';

const image = 'float4 mainImage(float2 fragCoord) { return float4(1); }';

describe('wrapSlangImageSource', () => {
  it('keeps fragment-context types aligned with the shared authoring catalog', () => {
    const source = wrapSlangImageSource(image);
    for (const name of ['iWorldPosition', 'iNormal', 'iCameraPosition']) {
      const fact = SHADER_STUDIO_BUILTIN_UNIFORMS.find((entry) => entry.name === name);
      expect(fact).toMatchObject({ name, slangType: 'float3', languages: ['glsl', 'slang'] });
      expect(source).toContain(`static float3 ${name};`);
    }
  });

  it('keeps shared uniforms and entry points while omitting legacy channel aliases', () => {
    const source = wrapSlangImageSource(image, { customUniforms: [{ name: 'gain', type: 'float' }] });
    for (const alias of ['iResolution', 'iMouse', 'iTime', 'iFrame', 'iSampleRate', 'iDate', 'gain']) {
      expect(source).toContain(`#define ${alias}`);
    }
    expect(source).not.toMatch(/#define iChannel(?:Time|Loaded|Resolution)/);
    expect(source).toContain(`[shader("vertex")]\nfloat4 ${SLANG_ENTRY_VERTEX}`);
    expect(source).toContain(`[shader("fragment")]\nfloat4 ${SLANG_ENTRY_FRAGMENT}`);
  });

  it('generates typed inputs with configured names, metadata, and sampling overloads', () => {
    const source = wrapSlangImageSource(image, {
      channels: [{ slot: 2, key: 'noiseMap' }, { slot: 1, key: 'environment', kind: 'cubemap' }],
    });
    expect(source).toContain('struct ShaderStudioInputs');
    expect(source).toContain('property ShaderStudioChannel2D noiseMap');
    expect(source).toContain('property ShaderStudioChannelCube environment');
    expect(source).toContain('static ShaderStudioInputs inputs;');
    expect(source).toContain('Texture2D<float4> _ssTexture2;');
    expect(source).toContain('SamplerState _ssSampler2;');
    expect(source).toContain('uint2 size;');
    expect(source).toContain('float time;');
    expect(source).toContain('bool loaded;');
    expect(source).toContain('float4 Sample(SamplerState sampling, float2 uv)');
    expect(source).toContain('float4 SampleLevel(float2 uv, float lod)');
    expect(source).toContain('float4 SampleGrad(float3 dir, float3 dx, float3 dy)');
    expect(source).toContain('float2(uv.x, 1.0 - uv.y)');
    expect(source).toContain('float2(dx.x, -dx.y)');
    expect(source).not.toMatch(/\biCh\d|\bsampleIChannel|\biChannel\d+Sampler/);
  });

  it('does not fabricate missing inputs', () => {
    const source = wrapSlangImageSource(image);
    expect(source).toContain('struct ShaderStudioInputs');
    expect(source).not.toContain('_ssTexture0');
    expect(source).not.toContain('sampleIChannel0');
  });

  it('keeps vertex hooks as authored and requires their explicit sampling choice', () => {
    const vertex = 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.x += inputs.noiseMap.SampleLevel(uv, 0.0).x; }';
    const source = wrapSlangImageSource(image, { channels: [{ slot: 0, key: 'noiseMap' }], vertexCode: vertex });
    expect(source).toContain(vertex);
    expect(source).toContain('mainVertex(position, normal, uv);');
    expect(source).not.toMatch(/sampleIChannel\d+Vertex|#define sample/);
  });
});
