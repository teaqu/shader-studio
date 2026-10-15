import { readFileSync } from 'node:fs';
import { decodeVolumeTexture } from './VolumeTexture';
import { describe, expect, it } from 'vitest';
import {
  SHADER_STUDIO_DEFAULT_ASSETS,
  shaderStudioDefaultAssetRelativePath,
} from './DefaultAssets';

describe('Shader Studio default assets', () => {
  it('maps stable logical asset URIs to files shipped in the UI bundle', () => {
    expect(shaderStudioDefaultAssetRelativePath(SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture))
      .toBe('assets/nebula-texture.png');
    expect(shaderStudioDefaultAssetRelativePath(SHADER_STUDIO_DEFAULT_ASSETS.desertCubemap))
      .toBe('assets/desert-cubemap-cross.png');
  });

  it.each(['noise-grey', 'noise-rgba'])('ships the built-in %s volume in both hosts', (name) => {
    expect(shaderStudioDefaultAssetRelativePath(`shader-studio://volumes/${name}`))
      .toBe(`assets/${name}.ktx2`);
    const bytes = readFileSync(new URL(`../../standalone/public/assets/${name}.ktx2`, import.meta.url));
    expect(bytes).toEqual(readFileSync(new URL(`../../tests/fixtures/shader-corpus/assets/volume-input/${name}.ktx2`, import.meta.url)));
    expect(decodeVolumeTexture(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
      .toMatchObject({ width: 32, height: 32, depth: 32, channels: name === 'noise-grey' ? 1 : 4 });
  });

  it('does not claim ordinary workspace paths or unknown built-ins', () => {
    expect(shaderStudioDefaultAssetRelativePath('./texture.png')).toBeNull();
    expect(shaderStudioDefaultAssetRelativePath('shader-studio://textures/unknown')).toBeNull();
  });

  it.each(['nebula', 'cherry-blossoms', 'moonlit-ocean', 'fireflies'])('does not resolve the removed %s video', (name) => {
    expect(shaderStudioDefaultAssetRelativePath(`shader-studio://videos/${name}`)).toBeNull();
  });
});
