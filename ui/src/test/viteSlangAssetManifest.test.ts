import { describe, expect, it } from 'vitest';
import { createSlangAssetManifest } from '../../viteSlangAssetManifest';

describe('createSlangAssetManifest', () => {
  it('maps exactly one runtime, wasm, and worker asset', () => {
    expect(
      createSlangAssetManifest([
        'assets/index-123.js',
        'assets/slang-wasm-runtime123.js',
        'assets/slang-wasm-module456.wasm',
        'assets/slangCompileWorker-worker789.js',
      ]),
    ).toEqual({
      script: 'assets/slang-wasm-runtime123.js',
      wasm: 'assets/slang-wasm-module456.wasm',
      worker: 'assets/slangCompileWorker-worker789.js',
    });
  });

  it('rejects a missing runtime asset', () => {
    expect(() =>
      createSlangAssetManifest([
        'assets/slang-wasm-module456.wasm',
        'assets/slangCompileWorker-worker789.js',
      ]),
    ).toThrow('Expected exactly one Slang runtime asset, found 0: none');
  });

  it('rejects a missing wasm asset', () => {
    expect(() =>
      createSlangAssetManifest([
        'assets/slang-wasm-runtime123.js',
        'assets/slangCompileWorker-worker789.js',
      ]),
    ).toThrow('Expected exactly one Slang wasm asset, found 0: none');
  });

  it('rejects a missing worker asset', () => {
    expect(() =>
      createSlangAssetManifest([
        'assets/slang-wasm-runtime123.js',
        'assets/slang-wasm-module456.wasm',
      ]),
    ).toThrow('Expected exactly one Slang worker asset, found 0: none');
  });

  it('rejects duplicate runtime assets and lists the matches', () => {
    expect(() =>
      createSlangAssetManifest([
        'assets/slang-wasm-runtime123.js',
        'nested/slang-wasm-runtime456.js',
        'assets/slang-wasm-module456.wasm',
        'assets/slangCompileWorker-worker789.js',
      ]),
    ).toThrow(
      'Expected exactly one Slang runtime asset, found 2: assets/slang-wasm-runtime123.js, nested/slang-wasm-runtime456.js',
    );
  });
});
