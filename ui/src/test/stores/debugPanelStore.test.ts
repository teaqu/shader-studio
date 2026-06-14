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
    expect(state.normalizeMode).toBe('off');
    expect(state.isStepEnabled).toBe(false);
    expect(state.stepEdge).toBe(0.5);
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

  it('setNormalizeMode updates the field', async () => {
    const { debugPanelStore } = await importStore();
    debugPanelStore.setNormalizeMode('soft');
    expect(get(debugPanelStore).normalizeMode).toBe('soft');
    debugPanelStore.setNormalizeMode('abs');
    expect(get(debugPanelStore).normalizeMode).toBe('abs');
    debugPanelStore.setNormalizeMode('off');
    expect(get(debugPanelStore).normalizeMode).toBe('off');
  });

  it('setStepEnabled updates the field', async () => {
    const { debugPanelStore } = await importStore();
    debugPanelStore.setStepEnabled(true);
    expect(get(debugPanelStore).isStepEnabled).toBe(true);
    debugPanelStore.setStepEnabled(false);
    expect(get(debugPanelStore).isStepEnabled).toBe(false);
  });

  it('setStepEdge updates the field', async () => {
    const { debugPanelStore } = await importStore();
    debugPanelStore.setStepEdge(0.75);
    expect(get(debugPanelStore).stepEdge).toBe(0.75);
    debugPanelStore.setStepEdge(0.1);
    expect(get(debugPanelStore).stepEdge).toBe(0.1);
  });

  it('snapshotDebugPanel returns full state including new fields', async () => {
    const { debugPanelStore, snapshotDebugPanel } = await importStore();
    debugPanelStore.setVisible(true);
    debugPanelStore.setVariableInspectorEnabled(true);
    debugPanelStore.setErrorsEnabled(true);
    debugPanelStore.setNormalizeMode('soft');
    debugPanelStore.setStepEnabled(true);
    debugPanelStore.setStepEdge(0.8);

    const snap = snapshotDebugPanel();

    expect(snap.isVisible).toBe(true);
    expect(snap.isVariableInspectorEnabled).toBe(true);
    expect(snap.isInlineRenderingEnabled).toBe(true);
    expect(snap.isPixelInspectorEnabled).toBe(true);
    expect(snap.isErrorsEnabled).toBe(true);
    expect(snap.normalizeMode).toBe('soft');
    expect(snap.isStepEnabled).toBe(true);
    expect(snap.stepEdge).toBe(0.8);
  });

  it('applyDebugPanelProfile sets all fields including new ones', async () => {
    const { debugPanelStore, applyDebugPanelProfile } = await importStore();
    applyDebugPanelProfile({
      isVisible: true,
      isVariableInspectorEnabled: true,
      isInlineRenderingEnabled: false,
      isPixelInspectorEnabled: false,
      isErrorsEnabled: true,
      normalizeMode: 'abs',
      isStepEnabled: true,
      stepEdge: 0.3,
    });

    const state = get(debugPanelStore);
    expect(state.isVisible).toBe(true);
    expect(state.isVariableInspectorEnabled).toBe(true);
    expect(state.isInlineRenderingEnabled).toBe(false);
    expect(state.isPixelInspectorEnabled).toBe(false);
    expect(state.isErrorsEnabled).toBe(true);
    expect(state.normalizeMode).toBe('abs');
    expect(state.isStepEnabled).toBe(true);
    expect(state.stepEdge).toBe(0.3);
  });

  it('applyDebugPanelProfile fills missing new fields with defaults for old profiles', async () => {
    const { debugPanelStore, applyDebugPanelProfile } = await importStore();
    // Simulate an old profile saved before new fields were added
    applyDebugPanelProfile({
      isVisible: false,
      isVariableInspectorEnabled: false,
      isInlineRenderingEnabled: true,
      isPixelInspectorEnabled: true,
      isErrorsEnabled: false,
    } as any);

    const state = get(debugPanelStore);
    expect(state.normalizeMode).toBe('off');
    expect(state.isStepEnabled).toBe(false);
    expect(state.stepEdge).toBe(0.5);
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
