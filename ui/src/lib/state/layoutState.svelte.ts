import type { SerializedLayout } from '@shader-studio/types';

let _currentLayout = $state<SerializedLayout | null>(null);
let _pendingLayout = $state<SerializedLayout | null>(null);
let _hasPendingLayout = $state(false);

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
  _pendingLayout = layout;
  _hasPendingLayout = true;
}

/** Called by DockviewLayout after it has applied the pending layout. */
export function clearPendingLayout(): void {
  _pendingLayout = null;
  _hasPendingLayout = false;
}

/** Read reactively in DockviewLayout's $effect. */
export function getPendingLayout(): SerializedLayout | null {
  return _pendingLayout;
}

/** Distinguishes "restore default layout" from "no restore requested". */
export function hasPendingLayout(): boolean {
  return _hasPendingLayout;
}
