import { describe, expect, it } from 'vitest';
import { getSlangAssetUrls } from '../lib/slangAssets';

describe('getSlangAssetUrls', () => {
  it('keeps Slang timing diagnostics disabled by default', () => {
    expect(getSlangAssetUrls().debugTimings).not.toBe(true);
  });
});
