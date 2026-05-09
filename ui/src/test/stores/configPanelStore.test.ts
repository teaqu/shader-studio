import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('configPanelStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/configPanelStore');
    return mod;
  }

  it('should have default initial state (isVisible false)', async () => {
    const { configPanelStore } = await importStore();
    expect(get(configPanelStore).isVisible).toBe(false);
  });

  it('toggle flips visibility', async () => {
    const { configPanelStore } = await importStore();
    configPanelStore.setVisible(false);
    configPanelStore.toggle();
    expect(get(configPanelStore).isVisible).toBe(true);
    configPanelStore.toggle();
    expect(get(configPanelStore).isVisible).toBe(false);
  });

  it('setVisible sets visibility directly', async () => {
    const { configPanelStore } = await importStore();
    configPanelStore.setVisible(true);
    expect(get(configPanelStore).isVisible).toBe(true);
    configPanelStore.setVisible(false);
    expect(get(configPanelStore).isVisible).toBe(false);
  });

  it('snapshotConfigPanel returns current state', async () => {
    const { configPanelStore, snapshotConfigPanel } = await importStore();
    configPanelStore.setVisible(true);
    expect(snapshotConfigPanel()).toEqual({ isVisible: true });
  });

  it('snapshotConfigPanel returns false when hidden', async () => {
    const { configPanelStore, snapshotConfigPanel } = await importStore();
    configPanelStore.setVisible(false);
    expect(snapshotConfigPanel()).toEqual({ isVisible: false });
  });

  it('applyConfigPanelProfile sets state from profile data', async () => {
    const { configPanelStore, applyConfigPanelProfile } = await importStore();
    applyConfigPanelProfile({ isVisible: true });
    expect(get(configPanelStore).isVisible).toBe(true);
  });

  it('applyConfigPanelProfile can set isVisible false', async () => {
    const { configPanelStore, applyConfigPanelProfile } = await importStore();
    configPanelStore.setVisible(true);
    applyConfigPanelProfile({ isVisible: false });
    expect(get(configPanelStore).isVisible).toBe(false);
  });
});
