import type { NormalizedOutputOptions, OutputBundle, PluginContext } from 'rollup';
import { describe, expect, it, vi } from 'vitest';
import {
  createSlangAssetManifest,
  slangAssetManifestPlugin,
} from '../../viteSlangAssetManifest';

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

describe('slangAssetManifestPlugin', () => {
  it('emits a pretty-printed manifest with a trailing newline', () => {
    const generateBundle = slangAssetManifestPlugin().generateBundle;
    const emitFile = vi.fn(() => 'manifest-reference');

    if (typeof generateBundle !== 'function') {
      throw new Error('Expected slangAssetManifestPlugin to define a generateBundle hook');
    }

    // The hook only uses emitFile, so a complete Rollup plugin context is unnecessary here.
    const context = { emitFile } as unknown as PluginContext;
    // The hook only reads bundle keys and ignores output options.
    const bundle = {
      'assets/slang-wasm-runtime123.js': {},
      'assets/slang-wasm-module456.wasm': {},
      'assets/slangCompileWorker-worker789.js': {},
    } as unknown as OutputBundle;
    const outputOptions = {} as unknown as NormalizedOutputOptions;

    generateBundle.call(context, outputOptions, bundle, false);

    expect(emitFile).toHaveBeenCalledExactlyOnceWith({
      type: 'asset',
      fileName: 'slang-assets.json',
      source: `${JSON.stringify(
        {
          script: 'assets/slang-wasm-runtime123.js',
          wasm: 'assets/slang-wasm-module456.wasm',
          worker: 'assets/slangCompileWorker-worker789.js',
        },
        null,
        2,
      )}\n`,
    });
  });

  it('propagates validation failures without emitting a manifest', () => {
    const generateBundle = slangAssetManifestPlugin().generateBundle;
    const emitFile = vi.fn(() => 'manifest-reference');

    if (typeof generateBundle !== 'function') {
      throw new Error('Expected slangAssetManifestPlugin to define a generateBundle hook');
    }

    // The hook only uses emitFile, so a complete Rollup plugin context is unnecessary here.
    const context = { emitFile } as unknown as PluginContext;
    // This intentionally incomplete bundle exercises the selector validation path.
    const bundle = {
      'assets/slang-wasm-runtime123.js': {},
      'assets/slang-wasm-module456.wasm': {},
    } as unknown as OutputBundle;
    const outputOptions = {} as unknown as NormalizedOutputOptions;

    expect(() => generateBundle.call(context, outputOptions, bundle, false)).toThrow(
      'Expected exactly one Slang worker asset, found 0: none',
    );
    expect(emitFile).not.toHaveBeenCalled();
  });
});
