import { writable } from 'svelte/store';

export interface PerformancePanelState {
  isVisible: boolean;
}

const DEFAULT_STATE: PerformancePanelState = { isVisible: false };
const _store = writable<PerformancePanelState>(DEFAULT_STATE);

export const performancePanelStore = {
  subscribe: _store.subscribe,
  toggle: () => _store.update(s => ({ ...s, isVisible: !s.isVisible })),
  setVisible: (visible: boolean) => _store.update(s => ({ ...s, isVisible: visible })),
};

export function snapshotPerformancePanel(): PerformancePanelState {
  let state = DEFAULT_STATE;
  _store.subscribe(s => {
    state = s; 
  })();
  return state;
}

export function applyPerformancePanelProfile(data: PerformancePanelState): void {
  _store.set(data);
}
