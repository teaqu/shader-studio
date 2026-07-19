import type { Plugin } from 'vite';

export interface SlangAssetManifest {
  script: string;
  wasm: string;
  worker: string;
}

function selectExactlyOne(files: readonly string[], pattern: RegExp, label: string): string {
  const matches = files.filter((file) => pattern.test(file));

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Slang ${label} asset, found ${matches.length}: ${matches.join(', ') || 'none'}`,
    );
  }

  return matches[0];
}

export function createSlangAssetManifest(files: readonly string[]): SlangAssetManifest {
  return {
    script: selectExactlyOne(files, /(^|\/)slang-wasm-[^/]+\.js$/, 'runtime'),
    wasm: selectExactlyOne(files, /(^|\/)slang-wasm-[^/]+\.wasm$/, 'wasm'),
    worker: selectExactlyOne(files, /(^|\/)slangCompileWorker-[^/]+\.js$/, 'worker'),
  };
}

export function slangAssetManifestPlugin(): Plugin {
  return {
    name: 'slang-asset-manifest',
    generateBundle(_, bundle) {
      const manifest = createSlangAssetManifest(Object.keys(bundle));

      this.emitFile({
        type: 'asset',
        fileName: 'slang-assets.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}
