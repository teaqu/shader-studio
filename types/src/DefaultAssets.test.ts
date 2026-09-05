import { describe, expect, it } from 'vitest';
import {
  SHADER_STUDIO_DEFAULT_ASSETS,
  shaderStudioDefaultAssetRelativePath,
} from './DefaultAssets';

describe('Shader Studio default assets', () => {
  it('maps stable logical asset URIs to files shipped in the UI bundle', () => {
    expect(shaderStudioDefaultAssetRelativePath(SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture))
      .toBe('assets/nebula-texture.png');
    expect(shaderStudioDefaultAssetRelativePath(SHADER_STUDIO_DEFAULT_ASSETS.nebulaVideo))
      .toBe('assets/nebula-motion.mp4');
    expect(shaderStudioDefaultAssetRelativePath(SHADER_STUDIO_DEFAULT_ASSETS.desertCubemap))
      .toBe('assets/desert-cubemap-cross.png');
  });

  it('does not claim ordinary workspace paths or unknown built-ins', () => {
    expect(shaderStudioDefaultAssetRelativePath('./texture.png')).toBeNull();
    expect(shaderStudioDefaultAssetRelativePath('shader-studio://textures/unknown')).toBeNull();
  });
});
