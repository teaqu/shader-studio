import { describe, expect, it } from 'vitest';
import { getSlangAssetUrls } from '../lib/slangAssets';

describe('getSlangAssetUrls', () => {
  it('enables Slang timing diagnostics while startup performance is being investigated', () => {
    expect(getSlangAssetUrls().debugTimings).toBe(true);
  });
});
