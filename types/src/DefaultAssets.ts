export const SHADER_STUDIO_DEFAULT_ASSETS = {
  nebulaTexture: 'shader-studio://textures/nebula',
  nebulaVideo: 'shader-studio://videos/nebula',
  desertCubemap: 'shader-studio://cubemaps/desert',
} as const;

const DEFAULT_ASSET_PATHS: Readonly<Record<string, string>> = {
  [SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture]: 'assets/nebula-texture.png',
  [SHADER_STUDIO_DEFAULT_ASSETS.nebulaVideo]: 'assets/nebula-motion.mp4',
  [SHADER_STUDIO_DEFAULT_ASSETS.desertCubemap]: 'assets/desert-cubemap-cross.png',
};

export function shaderStudioDefaultAssetRelativePath(uri: string): string | null {
  return DEFAULT_ASSET_PATHS[uri] ?? null;
}
