import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('debugPanelStore', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function importStore() {
    const mod = await import('../../lib/stores/debugPanelStore');
    return mod;
  }

  it('should have default initial state', async () => {
    const { debugPanelStore } = await importStore();
    const state = get(debugPanelStore);
    expect(state.isVisible).toBe(false);
    expect(state.isVariableInspectorEnabled).toBe(false);
    expect(state.isInlineRenderingEnabled).toBe(true);
    expect(state.isPixelInspectorEnabled).toBe(true);
    expect(state.isErrorsEnabled).toBe(false);
  });

  it('toggle flips visibility', async () => {
    const { debugPanelStore } = await importStore();
    expect(get(debugPanelStore).isVisible).toBe(false);
    debugPanelStore.toggle();
    expect(get(debugPanelStore).isVisible).toBe(true);
    debugPanelStore.toggle();
    expect(get(debugPanelStore).isVisible).toBe(false);
  });

  it('setVisible sets visibility directly', async () => {
    const { debugPanelStore } = await importStore();
    debugPanelStore.setVisible(true);
    expect(get(debugPanelStore).isVisible).toBe(true);
    debugPanelStore.setVisible(false);
    expect(get(debugPanelStore).isVisible).toBe(false);
  });

  it('setVariableInspectorEnabled updates the field', async () => {
    const { debugPanelStore } = await importStore();
    debugPanelStore.setVariableInspectorEnabled(true);
    expect(get(debugPanelStore).isVariableInspectorEnabled).toBe(true);
    debugPanelStore.setVariableInspectorEnabled(false);
    expect(get(debugPanelStore).isVariableInspectorEnabled).toBe(false);
  });

  it('setInlineRenderingEnabled updates the field', async () => {
    const { debugPanelStore } = await importStore();
    debugPanelStore.setInlineRenderingEnabled(false);
    expect(get(debugPanelStore).isInlineRenderingEnabled).toBe(false);
    debugPanelStore.setInlineRenderingEnabled(true);
    expect(get(debugPanelStore).isInlineRenderingEnabled).toBe(true);
  });

  it('setPixelInspectorEnabled updates the field', async () => {
    const { debugPanelStore } = await importStore();
    debugPanelStore.setPixelInspectorEnabled(false);
    expect(get(debugPanelStore).isPixelInspectorEnabled).toBe(false);
  });

  it('setErrorsEnabled updates the field', async () => {
    const { debugPanelStore } = await importStore();
    debugPanelStore.setErrorsEnabled(true);
    expect(get(debugPanelStore).isErrorsEnabled).toBe(true);
    debugPanelStore.setErrorsEnabled(false);
    expect(get(debugPanelStore).isErrorsEnabled).toBe(false);
  });

  it('snapshotDebugPanel returns full state', async () => {
    const { debugPanelStore, snapshotDebugPanel } = await importStore();
    debugPanelStore.setVisible(true);
    debugPanelStore.setVariableInspectorEnabled(true);
    debugPanelStore.setErrorsEnabled(true);

    const snap = snapshotDebugPanel();

    expect(snap.isVisible).toBe(true);
    expect(snap.isVariableInspectorEnabled).toBe(true);
    expect(snap.isInlineRenderingEnabled).toBe(true);
    expect(snap.isPixelInspectorEnabled).toBe(true);
    expect(snap.isErrorsEnabled).toBe(true);
  });

  it('applyDebugPanelProfile sets all fields', async () => {
    const { debugPanelStore, applyDebugPanelProfile } = await importStore();
    applyDebugPanelProfile({
      isVisible: true,
      isVariableInspectorEnabled: true,
      isInlineRenderingEnabled: false,
      isPixelInspectorEnabled: false,
      isErrorsEnabled: true,
    });

    const state = get(debugPanelStore);
    expect(state.isVisible).toBe(true);
    expect(state.isVariableInspectorEnabled).toBe(true);
    expect(state.isInlineRenderingEnabled).toBe(false);
    expect(state.isPixelInspectorEnabled).toBe(false);
    expect(state.isErrorsEnabled).toBe(true);
  });

  it('applyDebugPanelProfile can set isVisible false', async () => {
    const { debugPanelStore, applyDebugPanelProfile } = await importStore();
    debugPanelStore.setVisible(true);
    applyDebugPanelProfile({
      isVisible: false,
      isVariableInspectorEnabled: false,
      isInlineRenderingEnabled: true,
      isPixelInspectorEnabled: true,
      isErrorsEnabled: false,
    });
    expect(get(debugPanelStore).isVisible).toBe(false);
  });
});
