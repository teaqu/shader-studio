import { writable } from 'svelte/store';

export interface RecordingPanelState {
  isVisible: boolean;
}

const DEFAULT_STATE: RecordingPanelState = { isVisible: false };

const _store = writable<RecordingPanelState>(DEFAULT_STATE);

export const recordingPanelStore = {
  subscribe: _store.subscribe,
  toggle: () => _store.update(s => ({ ...s, isVisible: !s.isVisible })),
  setVisible: (visible: boolean) => _store.update(s => ({ ...s, isVisible: visible })),
};
