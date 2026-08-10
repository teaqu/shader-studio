import { describe, expect, it } from 'vitest';
import { SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX, wrapSlangImageSource } from '../../webgpu/SlangPrelude';

const image = 'float4 mainImage(float2 fragCoord) { return float4(1); }';
const vertex = 'void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.y += 1; }';

describe('wrapSlangImageSource vertex hooks', () => {
  it('preserves the exact fixed uniform prelude emitted before the first channel helper', () => {
    const source = wrapSlangImageSource(image);
    const prelude = source.slice(0, source.indexOf('float4 sampleIChannel0(float2 uv)'));

    expect(prelude).toBe(`// ---- shader-studio Slang prelude (generated) ----
struct ShaderToyUniforms
{
    float4 resolution;
    float4 mouse;
    float time;
    float timeDelta;
    float frameRate;
    int frame;
    float4 channelTime;
    float4 channelLoaded;
    float sampleRate;
    float4 date;
    float3 channelResolution[4];
    float4 cameraPos;
    float4 cameraDir;

};

[[vk::binding(0, 0)]]
ConstantBuffer<ShaderToyUniforms> _st;

#define iResolution (_st.resolution.xyz)
#define iMouse (_st.mouse)
#define iTime (_st.time)
#define iTimeDelta (_st.timeDelta)
#define iFrameRate (_st.frameRate)
#define iFrame (_st.frame)
#define iChannelTime (_st.channelTime)
#define iChannelLoaded (_st.channelLoaded)
#define iSampleRate (_st.sampleRate)
#define iDate (_st.date)
#define iChannelResolution (_st.channelResolution)
#define iCameraPos (_st.cameraPos.xyz)
#define iCameraDir (_st.cameraDir.xyz)

static float3 iWorldPosition;
static float3 iNormal;
static float3 iCameraPosition;

`);
  });

  it('keeps all shared uniform aliases and generated entry points in the final renderer wrapper', () => {
    const source = wrapSlangImageSource(image, {
      customUniforms: [
        { name: 'gain', type: 'float' },
        { name: 'enabled', type: 'bool' },
      ],
    });

    for (const alias of [
      '#define iResolution (_st.resolution.xyz)',
      '#define iMouse (_st.mouse)',
      '#define iTime (_st.time)',
      '#define iTimeDelta (_st.timeDelta)',
      '#define iFrameRate (_st.frameRate)',
      '#define iFrame (_st.frame)',
      '#define iChannelTime (_st.channelTime)',
      '#define iChannelLoaded (_st.channelLoaded)',
      '#define iSampleRate (_st.sampleRate)',
      '#define iDate (_st.date)',
      '#define iChannelResolution (_st.channelResolution)',
      '#define iCameraPos (_st.cameraPos.xyz)',
      '#define iCameraDir (_st.cameraDir.xyz)',
      '#define gain (_st.custom_gain)',
      '#define enabled (_st.custom_enabled != 0)',
    ]) {
      expect(source).toContain(alias);
    }
    expect(source).toContain(`[shader("vertex")]\nfloat4 ${SLANG_ENTRY_VERTEX}`);
    expect(source).toContain(`[shader("fragment")]\nfloat4 ${SLANG_ENTRY_FRAGMENT}`);
  });

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
