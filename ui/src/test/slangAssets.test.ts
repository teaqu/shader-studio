import { afterEach, describe, expect, it } from 'vitest';
import { getSlangAssetUrls, installSlangAssetMetadata } from '../lib/slangAssets';

describe('getSlangAssetUrls', () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __slangPerf?: boolean }).__slangPerf;
    document.head.replaceChildren();
  });

  it('keeps Slang timing diagnostics disabled by default', () => {
    expect(getSlangAssetUrls().debugTimings).toBe(false);
  });

  it('enables Slang timing diagnostics when explicitly requested', () => {
    (globalThis as typeof globalThis & { __slangPerf?: boolean }).__slangPerf = true;

    expect(getSlangAssetUrls().debugTimings).toBe(true);
  });

  it('installs the asset metadata required by the embedded Shader Explorer', () => {
    installSlangAssetMetadata();

    expect(document.querySelector<HTMLMetaElement>('meta[name="shader-studio-slang-script-url"]')?.content).toBeTruthy();
    expect(document.querySelector<HTMLMetaElement>('meta[name="shader-studio-slang-wasm-url"]')?.content).toBeTruthy();
    expect(document.querySelector<HTMLMetaElement>('meta[name="shader-studio-slang-worker-url"]')?.content).toBeTruthy();
  });
});
