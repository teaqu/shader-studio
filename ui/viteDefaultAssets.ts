import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { createRequire } from 'node:module';

// The shared package's CommonJS entry can run in Node without Vite's source aliases.
const { SHADER_STUDIO_DEFAULT_ASSETS, shaderStudioDefaultAssetRelativePath } =
  createRequire(import.meta.url)('@shader-studio/types') as typeof import('@shader-studio/types');

/** Ship the same source images as standalone in the extension's UI bundle. */
export function defaultAssetsPlugin(): Plugin {
  return {
    name: 'shader-studio-default-assets',
    generateBundle() {
      for (const uri of Object.values(SHADER_STUDIO_DEFAULT_ASSETS)) {
        const fileName = shaderStudioDefaultAssetRelativePath(uri)!;
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(new URL(`../standalone/public/${fileName}`, import.meta.url)),
        });
      }
    },
  };
}
