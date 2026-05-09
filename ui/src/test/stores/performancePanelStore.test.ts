import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('performancePanelStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/performancePanelStore');
    return mod;
  }

  it('should have default initial state (isVisible false)', async () => {
    const { performancePanelStore } = await importStore();
    expect(get(performancePanelStore).isVisible).toBe(false);
  });

  it('toggle flips visibility', async () => {
    const { performancePanelStore } = await importStore();
    performancePanelStore.setVisible(false);
    performancePanelStore.toggle();
    expect(get(performancePanelStore).isVisible).toBe(true);
    performancePanelStore.toggle();
    expect(get(performancePanelStore).isVisible).toBe(false);
  });

  it('setVisible sets visibility directly', async () => {
    const { performancePanelStore } = await importStore();
    performancePanelStore.setVisible(true);
    expect(get(performancePanelStore).isVisible).toBe(true);
    performancePanelStore.setVisible(false);
    expect(get(performancePanelStore).isVisible).toBe(false);
  });

  it('snapshotPerformancePanel returns current state', async () => {
    const { performancePanelStore, snapshotPerformancePanel } = await importStore();
    performancePanelStore.setVisible(true);
    expect(snapshotPerformancePanel()).toEqual({ isVisible: true });
  });

  it('snapshotPerformancePanel returns false when hidden', async () => {
    const { performancePanelStore, snapshotPerformancePanel } = await importStore();
    performancePanelStore.setVisible(false);
    expect(snapshotPerformancePanel()).toEqual({ isVisible: false });
  });

  it('applyPerformancePanelProfile sets state', async () => {
    const { performancePanelStore, applyPerformancePanelProfile } = await importStore();
    applyPerformancePanelProfile({ isVisible: true });
    expect(get(performancePanelStore).isVisible).toBe(true);
  });

  it('applyPerformancePanelProfile can set isVisible false', async () => {
    const { performancePanelStore, applyPerformancePanelProfile } = await importStore();
    performancePanelStore.setVisible(true);
    applyPerformancePanelProfile({ isVisible: false });
    expect(get(performancePanelStore).isVisible).toBe(false);
  });
});
