import { afterEach, describe, expect, it } from 'vitest';
import { getSlangAssetUrls } from '../lib/slangAssets';

describe('getSlangAssetUrls', () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __slangPerf?: boolean }).__slangPerf;
  });

  it('keeps Slang timing diagnostics disabled by default', () => {
    expect(getSlangAssetUrls().debugTimings).toBe(false);
  });

  it('enables Slang timing diagnostics when explicitly requested', () => {
    (globalThis as typeof globalThis & { __slangPerf?: boolean }).__slangPerf = true;

    expect(getSlangAssetUrls().debugTimings).toBe(true);
  });
});
