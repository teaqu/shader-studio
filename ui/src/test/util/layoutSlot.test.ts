import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('layoutSlot', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.head.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns injected layout slot from meta tag', async () => {
    document.head.innerHTML = '<meta name="shader-studio-layout-slot" content="vscode:2">';
    const { getInjectedLayoutSlot } = await import('../../lib/util/layoutSlot');
    expect(getInjectedLayoutSlot()).toBe('vscode:2');
  });

  it('allocates the first available web slot and reuses it within the session', async () => {
    const { allocateWebLayoutSlot } = await import('../../lib/util/layoutSlot');
    expect(allocateWebLayoutSlot()).toBe('web:1');
    expect(allocateWebLayoutSlot()).toBe('web:1');
  });

  it('allocates the next available web slot when another one is claimed', async () => {
    localStorage.setItem('shader-studio.web-layout-claims', JSON.stringify({ 'web:1': Date.now() }));
    const { allocateWebLayoutSlot } = await import('../../lib/util/layoutSlot');
    expect(allocateWebLayoutSlot()).toBe('web:2');
  });

  it('releases the claimed web slot', async () => {
    const { allocateWebLayoutSlot, releaseWebLayoutSlot } = await import('../../lib/util/layoutSlot');
    expect(allocateWebLayoutSlot()).toBe('web:1');
    releaseWebLayoutSlot();
    expect(sessionStorage.getItem('shader-studio.web-layout-slot')).toBeNull();
    expect(localStorage.getItem('shader-studio.web-layout-claims')).toBe('{}');
  });
});
