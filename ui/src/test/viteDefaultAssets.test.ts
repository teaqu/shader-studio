// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import type { RollupOutput } from 'rollup';
import { defaultAssetsPlugin } from '../../viteDefaultAssets';
import { SHADER_STUDIO_DEFAULT_ASSETS, shaderStudioDefaultAssetRelativePath } from '../../../types/src/DefaultAssets';

describe('extension default asset packaging', () => {
  it('invalidates cached builds when shared default image sources change', () => {
    const turbo = JSON.parse(readFileSync(new URL('../../../turbo.json', import.meta.url), 'utf8')) as { globalDependencies: string[] };
    for (const uri of Object.values(SHADER_STUDIO_DEFAULT_ASSETS)) {
      expect(turbo.globalDependencies).toContain(`standalone/public/${shaderStudioDefaultAssetRelativePath(uri)}`);
    }
  });
  it('emits the exact standalone image bytes at the shared catalog paths', async () => {
    const result = await build({
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      plugins: [defaultAssetsPlugin(), {
        name: 'test-entry',
        resolveId: id => id === 'test-entry' ? id : undefined,
        load: id => id === 'test-entry' ? 'export {}' : undefined,
      }],
      build: { write: false, minify: false, rollupOptions: { input: 'test-entry' } },
    }) as RollupOutput;
    for (const uri of Object.values(SHADER_STUDIO_DEFAULT_ASSETS)) {
      const fileName = shaderStudioDefaultAssetRelativePath(uri)!;
      const asset = result.output.find(output => output.fileName === fileName);
      expect(asset?.type).toBe('asset');
      if (asset?.type !== 'asset') {
        throw new Error(`Missing ${fileName}`);
      }
      expect(Buffer.from(asset.source)).toEqual(readFileSync(new URL(`../../../standalone/public/${fileName}`, import.meta.url)));
    }
  }, 30000);
});
