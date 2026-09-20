import { buildGlslNamedChannelDeclarations } from "../GlslShaderEnvironment";
import { buildWgslChannelAuthoringSource } from "./SlangChannels";
import { describe, expect, it } from 'vitest';
import { validateShaderAuthoringEnvironment, type ShaderAuthoringEnvironment } from './ShaderAuthoringEnvironment';

const environment: ShaderAuthoringEnvironment = {
  documentUri: 'file:///image.wgsl', languageId: 'wgsl', generation: 1, passName: 'Image', stage: 'fragment',
  customUniforms: [], virtualFiles: [], resources: [{ name: 'albedo', kind: 'texture-2d' }],
};
describe('public channel identifier collisions', () => {
  it.each(['albedoTexture', 'albedoSampler', 'albedoSample', 'albedoLoad', 'albedoSize'])('rejects the generated name %s as another resource', name => {
    expect(validateShaderAuthoringEnvironment({ ...environment, resources: [...environment.resources, { name, kind: 'texture-2d' }] }))
      .toContainEqual(expect.objectContaining({ code: 'generated-identifier-collision' }));
  });
  it('rejects generated handles colliding with custom uniforms', () => {
    expect(validateShaderAuthoringEnvironment({ ...environment, customUniforms: [{ name: 'albedoSampler', type: 'float' }] })).not.toEqual([]);
  });
  it.each(['wgsl', 'slang'] as const)('reserves shared helpers in %s', languageId => {
    expect(validateShaderAuthoringEnvironment({ ...environment, languageId, resources: [{ name: 'sample2DLevel', kind: 'texture-2d' }] })).not.toEqual([]);
  });
  it('allows unrelated suffixes and noncolliding texture names', () => {
    expect(validateShaderAuthoringEnvironment({ ...environment, resources: [...environment.resources, { name: 'otherTexture', kind: 'texture-2d' }] })).toEqual([]);
  });
});


describe('stage and shape declarations', () => {
  it('only offers the GLSL bias overload in fragment code', () => {
    const channel = [{ key: 'albedo', slot: 0, isCustomName: true, samplerType: 'sampler2D' as const }];
    expect(buildGlslNamedChannelDeclarations(channel)).toContain('float bias');
    expect(buildGlslNamedChannelDeclarations(channel, false)).not.toContain('float bias');
    expect(buildGlslNamedChannelDeclarations(channel, false)).toContain('textureLod(');
  });
  it('keeps analysis-only 3D metadata dimensions consistent with its texture type', () => {
    const source = buildWgslChannelAuthoringSource([{ name: 'volume', kind: 'texture-3d', slot: 0 }], false);
    expect(source).toContain('size: vec3u');
    expect(source).toContain('fn volumeSize() -> vec3u');
    expect(source).toContain('var volumeTexture: texture_3d<f32>');
    expect(source).not.toContain('fn sample3D(');
  });
});
