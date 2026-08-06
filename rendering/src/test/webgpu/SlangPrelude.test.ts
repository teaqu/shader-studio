import { describe, expect, it } from 'vitest';
import { wrapSlangImageSource } from '../../webgpu/SlangPrelude';

const image = 'float4 mainImage(float2 fragCoord) { return float4(1); }';
const vertex = 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.y += 1; }';

describe('wrapSlangImageSource vertex hooks', () => {
  it('runs a fullscreen vertex hook before returning clip-space position', () => {
    const source = wrapSlangImageSource(image, { vertexCode: vertex });
    expect(source).toContain(vertex);
    expect(source).toContain('mainVertex(position, normal, uv);');
    expect(source.indexOf('mainVertex(position, normal, uv);')).toBeGreaterThan(source.indexOf(vertex));
  });

  it('runs a mesh vertex hook before computing mesh world varyings', () => {
    const source = wrapSlangImageSource(image, { geometry: 'cube', vertexCode: vertex });
    expect(source.indexOf('mainVertex(position, normal, uv);')).toBeLessThan(source.indexOf('float4 worldPosition'));
    expect(source).toContain('output.uv = uv;');
  });

  it('uses explicit-LOD channel helpers in vertex hooks while preserving fragment helpers', () => {
    const source = wrapSlangImageSource(image, {
      channels: [{ slot: 0, key: 'iChannel0' }],
      vertexCode: 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.x += sampleIChannel0(uv).x; }',
    });

    expect(source).toContain('float4 sampleIChannel0Vertex(float2 uv)');
    expect(source).toContain('return iChannel0.SampleLevel(iChannel0Sampler, float2(uv.x, 1.0 - uv.y), 0.0);');
    expect(source).toContain('#define sampleIChannel0 sampleIChannel0Vertex');
    expect(source).toContain('#undef sampleIChannel0');
    expect(source).toContain('return iChannel0.Sample(iChannel0Sampler, float2(uv.x, 1.0 - uv.y));');
  });

  it('aliases custom channel helper names in vertex hooks', () => {
    const source = wrapSlangImageSource(image, {
      channels: [{ slot: 2, key: 'noiseMap' }],
      vertexCode: 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.y += sampleNoiseMap(uv).y; }',
    });

    expect(source).toContain('float4 sampleNoiseMapVertex(float2 uv)');
    expect(source).toContain('#define sampleNoiseMap sampleNoiseMapVertex');
    expect(source).toContain('#undef sampleNoiseMap');
  });

  it('uses explicit-LOD helpers for cubemap channels in vertex hooks', () => {
    const source = wrapSlangImageSource(image, {
      channels: [{ slot: 1, key: 'environment', kind: 'cubemap' }],
      vertexCode: 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position += sampleEnvironment(normal).xyz; }',
    });

    expect(source).toContain('float4 sampleIChannel1Vertex(float3 dir)');
    expect(source).toContain('return environment.SampleLevel(environmentSampler, dir, 0.0);');
    expect(source).toContain('#define sampleEnvironment sampleEnvironmentVertex');
  });
});
