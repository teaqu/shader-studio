import { writable } from 'svelte/store';

export interface ConfigPanelState {
  isVisible: boolean;
}

const DEFAULT_STATE: ConfigPanelState = { isVisible: false };

const _store = writable<ConfigPanelState>(DEFAULT_STATE);

export const configPanelStore = {
  subscribe: _store.subscribe,
  toggle: () => _store.update(s => ({ ...s, isVisible: !s.isVisible })),
  setVisible: (visible: boolean) => _store.update(s => ({ ...s, isVisible: visible })),
};

export function snapshotConfigPanel(): ConfigPanelState {
  let state = DEFAULT_STATE;
  _store.subscribe(s => {
    state = s; 
  })();
  return state;
}

export function applyConfigPanelProfile(data: ConfigPanelState): void {
  _store.set(data);
}
