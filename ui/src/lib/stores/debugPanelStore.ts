import { writable } from 'svelte/store';
import type { NormalizeMode } from '../types/ShaderDebugState';

export interface DebugPanelState {
  isVisible: boolean;
  isVariableInspectorEnabled: boolean;
  isInlineRenderingEnabled: boolean;
  isPixelInspectorEnabled: boolean;
  isPixelMarkerEnabled: boolean;
  isErrorsEnabled: boolean;
  normalizeMode: NormalizeMode;
  isStepEnabled: boolean;
  stepEdge: number;
}

const DEFAULT_STATE: DebugPanelState = {
  isVisible: false,
  isVariableInspectorEnabled: false,
  isInlineRenderingEnabled: true,
  isPixelInspectorEnabled: true,
  isPixelMarkerEnabled: true,
  isErrorsEnabled: false,
  normalizeMode: 'off',
  isStepEnabled: false,
  stepEdge: 0.5,
};

const _store = writable<DebugPanelState>(DEFAULT_STATE);

export const debugPanelStore = {
  subscribe: _store.subscribe,
  toggle: () => _store.update(s => ({ ...s, isVisible: !s.isVisible })),
  setVisible: (visible: boolean) => _store.update(s => ({ ...s, isVisible: visible })),
  setVariableInspectorEnabled: (enabled: boolean) =>
    _store.update(s => ({ ...s, isVariableInspectorEnabled: enabled })),
  setInlineRenderingEnabled: (enabled: boolean) =>
    _store.update(s => ({ ...s, isInlineRenderingEnabled: enabled })),
  setPixelInspectorEnabled: (enabled: boolean) =>
    _store.update(s => ({ ...s, isPixelInspectorEnabled: enabled })),
  setPixelMarkerEnabled: (enabled: boolean) =>
    _store.update(s => ({ ...s, isPixelMarkerEnabled: enabled })),
  setErrorsEnabled: (enabled: boolean) =>
    _store.update(s => ({ ...s, isErrorsEnabled: enabled })),
  setNormalizeMode: (mode: NormalizeMode) =>
    _store.update(s => ({ ...s, normalizeMode: mode })),
  setStepEnabled: (enabled: boolean) =>
    _store.update(s => ({ ...s, isStepEnabled: enabled })),
  setStepEdge: (edge: number) =>
    _store.update(s => ({ ...s, stepEdge: edge })),
};

export function snapshotDebugPanel(): DebugPanelState {
  let state = DEFAULT_STATE;
  _store.subscribe(s => {
    state = s;
  })();
  return state;
}

export function applyDebugPanelProfile(data: Partial<DebugPanelState> & Pick<DebugPanelState, 'isVisible' | 'isVariableInspectorEnabled' | 'isInlineRenderingEnabled' | 'isPixelInspectorEnabled' | 'isErrorsEnabled'>): void {
  _store.set({ ...DEFAULT_STATE, ...data });
}
