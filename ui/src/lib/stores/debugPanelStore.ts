import { writable } from 'svelte/store';

export interface DebugPanelState {
  isVisible: boolean;
  isVariableInspectorEnabled: boolean;
  isInlineRenderingEnabled: boolean;
  isPixelInspectorEnabled: boolean;
  isErrorsEnabled: boolean;
}

const DEFAULT_STATE: DebugPanelState = {
  isVisible: false,
  isVariableInspectorEnabled: false,
  isInlineRenderingEnabled: true,
  isPixelInspectorEnabled: true,
  isErrorsEnabled: false,
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
  setErrorsEnabled: (enabled: boolean) =>
    _store.update(s => ({ ...s, isErrorsEnabled: enabled })),
};

export function snapshotDebugPanel(): DebugPanelState {
  let state = DEFAULT_STATE;
  _store.subscribe(s => {
    state = s;
  })();
  return state;
}

export function applyDebugPanelProfile(data: DebugPanelState): void {
  _store.set(data);
}
