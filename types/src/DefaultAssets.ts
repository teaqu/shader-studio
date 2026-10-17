export const SHADER_STUDIO_DEFAULT_ASSETS = {
  nebulaTexture: 'shader-studio://textures/nebula',
  noiseGreyVolume: 'shader-studio://volumes/noise-grey',
  noiseRgbaVolume: 'shader-studio://volumes/noise-rgba',
  desertCubemap: 'shader-studio://cubemaps/desert',
} as const;

const DEFAULT_ASSET_PATHS: Readonly<Record<string, string>> = {
  [SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture]: 'assets/nebula-texture.png',
  [SHADER_STUDIO_DEFAULT_ASSETS.noiseGreyVolume]: 'assets/noise-grey.ktx2',
  [SHADER_STUDIO_DEFAULT_ASSETS.noiseRgbaVolume]: 'assets/noise-rgba.ktx2',
  [SHADER_STUDIO_DEFAULT_ASSETS.desertCubemap]: 'assets/desert-cubemap-cross.png',
};

export function shaderStudioDefaultAssetRelativePath(uri: string): string | null {
  return DEFAULT_ASSET_PATHS[uri] ?? null;
}
