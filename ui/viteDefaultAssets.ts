import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { createRequire } from 'node:module';

/** Ship the same built-in assets as standalone in the extension's UI bundle. */
export function defaultAssetsPlugin(): Plugin {
  return {
    name: 'shader-studio-default-assets',
    generateBundle() {
      // Config inspection runs before workspace builds; load the public package
      // only when emitting assets, after the build has prepared its dependencies.
      const { SHADER_STUDIO_DEFAULT_ASSETS, shaderStudioDefaultAssetRelativePath } =
        createRequire(import.meta.url)('@shader-studio/types') as typeof import('@shader-studio/types');
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
