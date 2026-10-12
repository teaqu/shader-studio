import { describe, expect, it } from 'vitest';
import { createCubemapPreview } from '../../lib/cubemapPreview';
import type { ShaderConfig } from '@shader-studio/types';

const config = { version: '1', passes: { Image: { inputs: { old: { type: 'texture' as const, path: 'old.png' } } }, Cube: { path: 'cube.glsl', outputKind: 'cubemap' as const }, Plain: { path: 'plain.glsl' } } };

describe('createCubemapPreview', () => {
  it('returns null unless the selected pass is a cubemap', () => {
    expect(createCubemapPreview({ config, passName: 'Plain', language: 'glsl', mode: 'face', face: 'positive-x' })).toBeNull();
    expect(createCubemapPreview({ config: null, passName: 'Cube', language: 'glsl', mode: 'face', face: 'positive-x' })).toBeNull();
  });

  it('keeps all source passes and replaces Image inputs with the selected cubemap', () => {
    const result = createCubemapPreview({ config, passName: 'Cube', language: 'glsl', mode: 'face', face: 'negative-y' })!;
    expect(result.config.passes.Cube).toEqual(config.passes.Cube);
    expect(result.config.passes.Plain).toEqual(config.passes.Plain);
    expect(result.config.passes.Image!.inputs).toEqual({ iChannel0: { type: 'buffer', source: 'Cube', filter: 'linear', wrap: 'clamp' } });
    expect(config.passes.Image.inputs).toHaveProperty('old');
    expect(result.code).toContain('texture(iChannel0');
    expect(result.code).toContain('faceDirection(uv, 3)');
    expect(result.code).toContain('vec2 p = 2.0 * uv - 1.0');
  });

  it.each(['glsl', 'slang', 'wgsl'] as const)('generates every %s display mode', language => {
    for (const mode of ['layout', 'environment'] as const) {
      const result = createCubemapPreview({ config, passName: 'Cube', language, mode, face: 'positive-z' })!;
      expect(result.code).toContain(mode === 'layout' ? 'layoutSample(uv)' : 'environmentDirection(uv)');
    }
  });

  it('uses the native cube channel API for Slang and WGSL', () => {
    expect(createCubemapPreview({ config, passName: 'Cube', language: 'slang', mode: 'face', face: 'positive-z' })!.code).toContain('iChannel0.Sample');
    expect(createCubemapPreview({ config, passName: 'Cube', language: 'wgsl', mode: 'face', face: 'positive-z' })!.code).toContain('iChannel0Sample');
  });

  it('creates an Image pass when the source project has none', () => {
    const noImage = { version: '1', passes: { Cube: { path: 'cube.glsl', outputKind: 'cubemap' as const } } } as unknown as ShaderConfig;
    expect(createCubemapPreview({ config: noImage, passName: 'Cube', language: 'glsl', mode: 'face', face: 'positive-x' })?.config.passes.Image).toEqual({ inputs: { iChannel0: { type: 'buffer', source: 'Cube', filter: 'linear', wrap: 'clamp' } } });
  });

  it('retains Image resolution but strips mesh and native settings', () => {
    const source = { version: '1', passes: { Image: { resolution: { width: 32, height: 24 }, geometry: { type: 'cube' as const }, vertex: 'mesh.vert', entryPoints: { fragment: 'native' } }, Cube: { path: 'cube.glsl', outputKind: 'cubemap' as const } } };
    expect(createCubemapPreview({ config: source, passName: 'Cube', language: 'glsl', mode: 'layout', face: 'positive-x' })?.config.passes.Image).toEqual({ resolution: { width: 32, height: 24 }, inputs: { iChannel0: { type: 'buffer', source: 'Cube', filter: 'linear', wrap: 'clamp' } } });
  });

  it.each([['positive-x', 0], ['negative-x', 1], ['positive-y', 2], ['negative-y', 3], ['positive-z', 4], ['negative-z', 5]] as const)('uses the cubemap convention for %s', (face, index) => {
    expect(createCubemapPreview({ config, passName: 'Cube', language: 'glsl', mode: 'face', face })?.code).toContain(`faceDirection(uv, ${index})`);
  });
});
