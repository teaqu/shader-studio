import { describe, expect, it } from 'vitest';
import { SHADER_STUDIO_BUILTIN_UNIFORMS } from '@shader-studio/types';
import { findSlangChannelDeclarationCollisions, SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX, wrapSlangImageSource } from '../../webgpu/SlangPrelude';

const image = 'float4 mainImage(float2 fragCoord) { return float4(1); }';

describe('wrapSlangImageSource', () => {
  it('reports direct channel collisions in complete top-level declarations', () => {
    const collisions = findSlangChannelDeclarationCollisions([{ slot: 0, key: 'albedo' }], [
      { label: 'Image', source: 'float x; float albedo;\nfloat4\nalbedo(float2 uv) { return 0; }\n#define albedo 1' },
      { label: 'Common', source: 'struct\nalbedo\n{ float value; };\nproperty ShaderStudioChannel2D albedo { get { return albedo; } };\ntypedef float albedo;\ntypealias albedo = float;' },
    ]);

    expect(collisions).toEqual([
      'Slang channel "albedo" conflicts with an authored declaration in Image. Rename the channel or declaration.',
      'Slang channel "albedo" conflicts with an authored declaration in Common. Rename the channel or declaration.',
    ]);
  });

  it('permits locals, struct members, overloadable unrelated functions, and an authored inputs identifier', () => {
    const collisions = findSlangChannelDeclarationCollisions([{ slot: 0, key: 'albedo' }], [{
      label: 'Image',
      source: `struct Material { float albedo; };
float4 shade(float2 uv) { float albedo = 1; return float4(albedo); }
float4 inputs(float2 uv) { return 1; }`,
    }]);

    expect(collisions).toEqual([]);
  });

  it('treats inputs as an authored identifier unless it is configured as a direct channel', () => {
    const source = 'float inputs(float2 uv) { return 1; }';
    expect(findSlangChannelDeclarationCollisions([{ slot: 0, key: 'albedo' }], [{ label: 'Image', source }])).toEqual([]);
    expect(findSlangChannelDeclarationCollisions([{ slot: 0, key: 'inputs' }], [{ label: 'Image', source: '#define inputs 1' }])).toEqual([
      'Slang channel "inputs" conflicts with an authored declaration in Image. Rename the channel or declaration.',
    ]);
  });

  it('keeps fragment-context types aligned with the shared authoring catalog', () => {
    const source = wrapSlangImageSource(image);
    for (const name of ['iWorldPosition', 'iNormal', 'iCameraPosition']) {
      const fact = SHADER_STUDIO_BUILTIN_UNIFORMS.find((entry) => entry.name === name);
      expect(fact).toMatchObject({ name, slangType: 'float3', languages: ['glsl', 'slang', 'wgsl'] });
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

  it('generates direct typed channels with metadata and sampling overloads', () => {
    const source = wrapSlangImageSource(image, {
      channels: [{ slot: 2, key: 'noiseMap' }, { slot: 1, key: 'environment', kind: 'cubemap' }],
    });
    expect(source).not.toContain('ShaderStudioInputs');
    expect(source).toContain('property ShaderStudioChannel2D noiseMap');
    expect(source).toContain('property ShaderStudioChannelCube environment');
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

  it('does not fabricate missing channels', () => {
    const source = wrapSlangImageSource(image);
    expect(source).not.toContain('ShaderStudioInputs');
    expect(source).not.toContain('_ssTexture0');
    expect(source).not.toContain('sampleIChannel0');
  });

  it('keeps vertex hooks as authored and requires their explicit sampling choice', () => {
    const vertex = 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.x += noiseMap.SampleLevel(uv, 0.0).x; }';
    const source = wrapSlangImageSource(image, { channels: [{ slot: 0, key: 'noiseMap' }], vertexCode: vertex });
    expect(source).toContain(vertex);
    expect(source).toContain('mainVertex(position, normal, uv);');
    expect(source).not.toMatch(/sampleIChannel\d+Vertex|#define sample/);
  });
});
