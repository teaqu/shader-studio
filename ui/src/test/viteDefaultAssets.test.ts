// @vitest-environment node
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build, transformWithEsbuild } from 'vite';
import type { RollupOutput } from 'rollup';
import { defaultAssetsPlugin } from '../../viteDefaultAssets';
import { SHADER_STUDIO_DEFAULT_ASSETS, shaderStudioDefaultAssetRelativePath } from '../../../types/src/DefaultAssets';

describe('extension default asset packaging', () => {
  it('registers the build plugin before workspace packages exist', async () => {
    const source = readFileSync(new URL('../../viteDefaultAssets.ts', import.meta.url), 'utf8');
    const { code } = await transformWithEsbuild(source, 'viteDefaultAssets.ts', { loader: 'ts' });
    const directory = mkdtempSync(join(tmpdir(), 'default-assets-config-'));
    try {
      const file = join(directory, 'plugin.mjs');
      writeFileSync(file, `${code}\nif (defaultAssetsPlugin().name !== 'shader-studio-default-assets') throw new Error('Plugin registration failed');`);
      expect(() => execFileSync(process.execPath, [file], { stdio: 'pipe' })).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
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
      // Compare bytes natively; deep equality enumerates millions of buffer entries.
      const expected = readFileSync(new URL(`../../../standalone/public/${fileName}`, import.meta.url));
      expect(Buffer.from(asset.source).equals(expected), fileName).toBe(true);
    }
  }, 30000);
});
