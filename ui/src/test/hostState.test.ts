import { afterEach, describe, expect, it } from 'vitest';
import { configureHost, getHostCapabilities, getHostDefaultAssets, resetHost } from '../lib/state/hostState.svelte';

afterEach(resetHost);

describe('viewer host contract', () => {
  it('preserves extension capabilities by default', () => {
    expect(getHostCapabilities()).toEqual({ layoutProfiles: true });
    expect(getHostDefaultAssets()).toEqual([]);
  });

  it('allows a shell to disable unsupported features and resets to defaults', () => {
    configureHost({ capabilities: { layoutProfiles: false } });
    expect(getHostCapabilities().layoutProfiles).toBe(false);
    resetHost();
    expect(getHostCapabilities().layoutProfiles).toBe(true);
  });
});
