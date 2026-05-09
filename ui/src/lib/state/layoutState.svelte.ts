import type { SerializedLayout } from '@shader-studio/types';

let _currentLayout = $state<SerializedLayout | null>(null);
let _pendingRestore = $state<SerializedLayout | null>(null);

/** Called by DockviewLayout whenever the layout changes. */
export function setCurrentLayout(layout: SerializedLayout): void {
  _currentLayout = layout;
}

/** Called by profileStore to read the current layout for snapshotting. */
export function getCurrentLayout(): SerializedLayout | null {
  return _currentLayout;
}

/** Called by profileStore to trigger a layout restore in DockviewLayout. */
export function requestRestore(layout: SerializedLayout | null): void {
  _pendingRestore = layout;
}

/** Called by DockviewLayout after it has applied the pending restore. */
export function clearPendingRestore(): void {
  _pendingRestore = null;
}

/** Read reactively in DockviewLayout's $effect. */
export function getPendingRestore(): SerializedLayout | null {
  return _pendingRestore;
}
