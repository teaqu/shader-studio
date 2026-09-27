/**
 * Phone navigation is deliberately independent from Dockview's persisted
 * desktop layout. A rotation or breakpoint transition must never rewrite the
 * user's desktop panel arrangement.
 */
export type MobileShellPanel = 'explorer' | 'editor' | 'preview' | 'tools';

let mobileViewport = $state(false);
let mobilePanel = $state<MobileShellPanel>('preview');

export function isMobileViewport(): boolean {
  return mobileViewport;
}

export function setMobileViewport(value: boolean): void {
  mobileViewport = value;
}

export function getMobilePanel(): MobileShellPanel {
  return mobilePanel;
}

export function setMobilePanel(panel: MobileShellPanel): void {
  mobilePanel = panel;
}

export function resetMobileShellState(): void {
  mobileViewport = false;
  mobilePanel = 'preview';
}
