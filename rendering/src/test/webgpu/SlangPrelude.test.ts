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
    expect(SHADER_STUDIO_BUILTIN_UNIFORMS.find((entry) => entry.name === 'iVertexUv'))
      .toMatchObject({ slangType: 'float2', stages: ['fragment'] });
    expect(source).toContain('static float2 iVertexUv;');
  });

  it('keeps shared uniforms and entry points while omitting legacy channel aliases', () => {
    const source = wrapSlangImageSource(image, { customUniforms: [{ name: 'gain', type: 'float' }] });
    for (const alias of ['iResolution', 'iMouse', 'iTime', 'iFrame', 'iSampleRate', 'iDate', 'gain']) {
      expect(source).toContain(`#define ${alias}`);
    }
    expect(source).not.toMatch(/#define iChannel(?:Time|Loaded|Resolution)/);
    expect(source).toContain(`[shader("vertex")]\nShaderStudioVertexUvOut ${SLANG_ENTRY_VERTEX}`);
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
    const vertex = 'void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) { position.x += noiseMap.SampleLevel(uv, 0.0).x; }';
    const source = wrapSlangImageSource(image, { channels: [{ slot: 0, key: 'noiseMap' }], vertexCode: vertex });
    expect(source).toContain(vertex);
    expect(source).toContain('mainVertex(vertexID, position, normal, uv);');
    expect(source).not.toMatch(/sampleIChannel\d+Vertex|#define sample/);
  });

  it('runs a fullscreen hook with SV_VertexID over the oversized triangle', () => {
    const vertex = 'void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}';
    const source = wrapSlangImageSource(image, { vertexCode: vertex });
    expect(source).toContain('ShaderStudioVertexUvOut vertexMain(uint vertexID : SV_VertexID)');
    expect(source).toContain('float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };');
    expect(source).toContain('float3 position = float3(verts[vertexID], 0);');
    expect(source).toContain('float3 normal = float3(0, 0, 1);');
    expect(source).toContain('float2 uv = verts[vertexID] * 0.5 + 0.5;');
    expect(source).toContain('mainVertex(vertexID, position, normal, uv);');
  });

  describe('fullscreen stays as in #275', () => {
    const vertex = 'void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}';
    const DEFAULT_HOOK_ENTRY = 'ShaderStudioVertexUvOut vertexMain(uint vertexID : SV_VertexID) { float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) }; float3 position = float3(verts[vertexID], 0); float3 normal = float3(0, 0, 1); float2 uv = verts[vertexID] * 0.5 + 0.5; mainVertex(vertexID, position, normal, uv); ShaderStudioVertexUvOut output; output.position = float4(position, 1); output.uv = uv; return output; }';

    it('keeps the source byte-for-byte and ignores vertexSpace', () => {
      for (const vertexCode of [undefined, vertex]) {
        const fullscreen = wrapSlangImageSource(image, { vertexCode });
        expect(wrapSlangImageSource(image, { vertexCode, geometry: 'fullscreen', vertexSpace: 'clip' })).toBe(fullscreen);
        expect(fullscreen).not.toContain('% 3u');
        expect(fullscreen).not.toContain('MeshUniforms');
      }
      expect(wrapSlangImageSource(image, { vertexCode: vertex })).toContain(DEFAULT_HOOK_ENTRY);
      expect(wrapSlangImageSource(image)).toContain('output.uv = verts[vertexID] * 0.5 + 0.5;');
    });

    it('declares iVertexCount from the uniform block vertexCount slot', () => {
      const source = wrapSlangImageSource(image);
      expect(source).toContain('    float4 cameraDir;\n    uint4 vertexCount;\n');
      expect(source).toContain('#define iVertexCount (_st.vertexCount.x)');
    });
  });

  describe('camera matrices', () => {
    it('declares column-major matrices after vertexCount and aliases them', () => {
      const source = wrapSlangImageSource(image);
      expect(source).toContain('    uint4 vertexCount;\n    column_major float4x4 viewMatrix;\n    column_major float4x4 projectionMatrix;\n    column_major float4x4 viewProjection;\n');
      expect(source).toContain('#define iViewMatrix (_st.viewMatrix)');
      expect(source).toContain('#define iProjectionMatrix (_st.projectionMatrix)');
      expect(source).toContain('#define iViewProjection (_st.viewProjection)');
    });
  });

  describe('instancing', () => {
    const vertex = 'void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}';

    it('declares iInstanceCount from the y lane of the vertexCount slot and a static iInstanceIndex', () => {
      const source = wrapSlangImageSource(image);
      expect(source).toContain('#define iInstanceCount (_st.vertexCount.y)');
      expect(source).toContain('static uint iInstanceIndex;');
    });

    it('leaves iInstanceIndex at its zero initial value for fullscreen and capture entries', () => {
      for (const source of [
        wrapSlangImageSource(image),
        wrapSlangImageSource(image, { vertexCode: vertex }),
        wrapSlangImageSource(image, { captureMode: true }),
      ]) {
        expect(source).not.toContain('instanceID : SV_InstanceID');
        expect(source).not.toContain('iInstanceIndex =');
        expect(source).not.toContain('instanceIndex :');
      }
    });

    it('declares iInstanceIndex before the hook so mainVertex can read it', () => {
      const source = wrapSlangImageSource(image, { geometry: 'cube', vertexCode: vertex });
      expect(source.indexOf('static uint iInstanceIndex;')).toBeLessThan(source.indexOf(vertex));
    });
  });

  describe('vertices geometry', () => {
    const vertex = 'void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) { position.x = float(vertexIndex); }';
    const SEED = 'iInstanceIndex = instanceID; float3 position = float3(0, 0, 0); float3 normal = float3(0, 0, 1); float2 uv = float2(0, 0); mainVertex(vertexID, position, normal, uv);';

    it.each([undefined, 'world'] as const)('projects world-space output through the camera with no vertex inputs (vertexSpace %s)', (vertexSpace) => {
      const source = wrapSlangImageSource(image, { geometry: 'vertices', vertexCode: vertex, ...(vertexSpace ? { vertexSpace } : {}) });

      expect(source).toContain('ConstantBuffer<MeshUniforms> _mesh;');
      expect(source).toContain(`MeshVertexOut vertexMain(uint vertexID : SV_VertexID, uint instanceID : SV_InstanceID) { ${SEED} MeshVertexOut output; output.instanceIndex = instanceID;`);
      expect(source).toContain('nointerpolation uint instanceIndex : TEXCOORD3;');
      expect(source).toContain('iInstanceIndex = input.instanceIndex;');
      expect(source).toContain('output.position = mul(_mesh.viewProjection, worldPosition);');
      expect(source).toContain('float4 color = mainImage(input.uv * _st.resolution.xy);');
      expect(source).toContain('iVertexUv = input.uv;');
      expect(source).toContain('iFrontFacing = frontFacing;');
      expect(source).not.toContain('POSITION');
      expect(source).not.toContain('verts[');
    });

    it('writes clip-space output straight to SV_Position and shades with the pixel coordinate', () => {
      const source = wrapSlangImageSource(image, { geometry: 'vertices', vertexSpace: 'clip', vertexCode: vertex });

      expect(source).toContain(`ShaderStudioVertexUvOut vertexMain(uint vertexID : SV_VertexID, uint instanceID : SV_InstanceID) { ${SEED} ShaderStudioVertexUvOut output; output.position = float4(position, 1); output.uv = uv; output.instanceIndex = instanceID; return output; }`);
      expect(source).toContain('nointerpolation uint instanceIndex : TEXCOORD1;');
      expect(source).toContain('iInstanceIndex = input.instanceIndex;');
      expect(source).toContain('iVertexUv = input.uv;');
      expect(source).toContain('iFrontFacing = frontFacing;');
      expect(source).toContain('return mainImage(float2(input.position.x, _st.resolution.y - input.position.y));');
      expect(source).not.toContain('MeshUniforms');
      expect(source).not.toContain('MeshVertexOut');
      expect(source).not.toContain('verts[');
    });

    it.each(['world', 'clip'] as const)('declares a no-op hook in %s space when none is configured', (vertexSpace) => {
      const source = wrapSlangImageSource(image, { geometry: 'vertices', vertexSpace });

      expect(source).toContain('void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}');
      expect(source).toContain(SEED);
    });

    it('binds the world-space mesh uniforms after channels and storage, like meshes', () => {
      const options = {
        channels: [{ slot: 0, key: 'iChannel0', kind: 'texture' as const, textureBinding: 1, samplerBinding: 2 }],
        storage: [{ name: 'particles', binding: 0, elementType: 'float4', builtin: true, count: 4, stride: 16 }],
        vertexCode: vertex,
      } as never;
      const meshBinding = (source: string) => source.match(/\[\[vk::binding\((\d+), 0\)\]\]\nConstantBuffer<MeshUniforms>/)?.[1];

      expect(meshBinding(wrapSlangImageSource(image, { ...(options as object), geometry: 'vertices' })))
        .toBe(meshBinding(wrapSlangImageSource(image, { ...(options as object), geometry: 'cube' })));
    });

    it('ignores vertexSpace for mesh geometry and capture mode', () => {
      expect(wrapSlangImageSource(image, { geometry: 'cube', vertexCode: vertex, vertexSpace: 'clip' }))
        .toBe(wrapSlangImageSource(image, { geometry: 'cube', vertexCode: vertex }));
      expect(wrapSlangImageSource(image, { captureMode: true, geometry: 'vertices', vertexSpace: 'clip' }))
        .toBe(wrapSlangImageSource(image, { captureMode: true }));
    });
  });

  it('draws the fullscreen triangle without calling a hook when none is configured', () => {
    const source = wrapSlangImageSource(image);
    expect(source).toContain('ShaderStudioVertexUvOut vertexMain(uint vertexID : SV_VertexID)');
    expect(source).toContain('iVertexUv = input.uv;');
    expect(source).toContain('iFrontFacing = true;');
    expect(source).not.toContain('mainVertex');
  });

  it.each(['plane', 'cube', 'sphere', 'model'] as const)('passes the %s mesh vertex index to the hook', (geometry) => {
    const vertex = 'void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}';
    const source = wrapSlangImageSource(image, { geometry, vertexCode: vertex });
    expect(source).toContain('float2 uv : TEXCOORD0, uint vertexID : SV_VertexID, uint instanceID : SV_InstanceID) { iInstanceIndex = instanceID; mainVertex(vertexID, position, normal, uv);');
    expect(source).toContain('output.instanceIndex = instanceID;');
    expect(source).toContain('iInstanceIndex = input.instanceIndex;');
  });

  it('declares a vertex-index stub hook for meshes without vertex code', () => {
    const source = wrapSlangImageSource(image, { geometry: 'cube' });
    expect(source).toContain('void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv) {}');
    expect(source).toContain('mainVertex(vertexID, position, normal, uv);');
  });
});
