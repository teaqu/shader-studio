import { getMobileModeEnabled } from '../settings/settingsState.svelte';

/**
 * Phone navigation is deliberately independent from Dockview's persisted
 * desktop layout. A rotation or breakpoint transition must never rewrite the
 * user's desktop panel arrangement.
 */
export type MobileShellPanel = 'explorer' | 'files' | 'editor' | 'preview' | 'tools';

const PANEL_STORAGE_KEY = 'shader-studio.mobile-panel';

function readSavedPanel(): MobileShellPanel {
  try {
    const saved = globalThis.localStorage.getItem(PANEL_STORAGE_KEY);
    if (saved === 'explorer' || saved === 'files' || saved === 'editor' || saved === 'preview' || saved === 'tools') {
      return saved;
    }
  } catch {
    // Navigation still works when browser storage is unavailable.
  }
  return 'preview';
}

let mobileViewport = $state(false);
let mobilePanel = $state<MobileShellPanel>(readSavedPanel());
let visualViewportHeight = $state<number>();
let visualViewportTop = $state(0);
let mobileKeyboardInset = $state(0);
let mobileKeyboardOpen = $state(false);

export function getMobileVisualViewportHeight(): number | undefined {
  return visualViewportHeight;
}

export function getMobileVisualViewportTop(): number {
  return visualViewportTop;
}

export function getMobileKeyboardInset(): number {
  return mobileKeyboardInset;
}

export function isMobileKeyboardOpen(): boolean {
  return mobileKeyboardOpen;
}

/** Safari resizes its visual viewport when the keyboard opens, not the page. */
export function observeMobileVisualViewport(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) {
    return () => {};
  }
  let restingHeight = viewport.height;
  let viewportWidth = window.innerWidth;
  let pageScrollFrame = 0;
  const shouldResetPageScroll = () => isMobileViewport() && mobileKeyboardOpen
    && viewport.scale === 1 && window.scrollY !== 0;
  const keepPageAtOrigin = () => {
    if (pageScrollFrame || !shouldResetPageScroll()) {
      return;
    }
    pageScrollFrame = window.requestAnimationFrame(() => {
      pageScrollFrame = 0;
      if (!shouldResetPageScroll()) {
        return;
      }
      // iOS can scroll the document with its keyboard open even though the
      // full-screen shell has overflow:hidden. Only nested panels should scroll:
      // retaining that document pan feeds it back into our shell size/position.
      // Coalesce browser scroll events and leave the editor's scrollTop intact.
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      update();
    });
  };
  const update = () => {
    const unzoomed = viewport.scale === 1 && viewport.height > 0;
    // The visible rectangle has an independent size and position. Adding the
    // browser's pan offset to its height leaves the shell outside that rectangle.
    visualViewportHeight = unzoomed ? viewport.height : undefined;
    visualViewportTop = unzoomed ? viewport.offsetTop : 0;
    if (window.innerWidth !== viewportWidth) {
      viewportWidth = window.innerWidth;
      restingHeight = Math.max(viewport.height, window.innerHeight, document.documentElement.clientHeight);
    }
    const focused = document.activeElement;
    const editing = focused instanceof HTMLElement
      && focused.matches('textarea, input, [contenteditable="true"]')
      && focused.closest('[data-editor-engine]') !== null;
    const availableHeight = Math.max(restingHeight, window.innerHeight, document.documentElement.clientHeight);
    // Safari may resize innerHeight too, or briefly move focus to its controls.
    // Keep the keyboard state until the viewport recovers, rather than showing
    // navigation in the middle of the keyboard's dismissal animation.
    mobileKeyboardOpen = unzoomed && (editing || mobileKeyboardOpen) && availableHeight - viewport.height > 100;
    // The shell already starts at offsetTop. Extend code from the visual bottom
    // to the layout bottom, without adding that pan offset to the page height.
    // Floating controls still sit at offsetTop + height, above the keyboard.
    mobileKeyboardInset = mobileKeyboardOpen
      ? Math.max(0, availableHeight - (viewport.offsetTop + viewport.height)) : 0;
    if (unzoomed && !editing && !mobileKeyboardOpen) {
      restingHeight = viewport.height;
    }
    keepPageAtOrigin();
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  window.addEventListener('scroll', update);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', update);
  update();
  return () => {
    window.cancelAnimationFrame(pageScrollFrame);
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    window.removeEventListener('scroll', update);
    document.removeEventListener('focusin', update);
    document.removeEventListener('focusout', update);
    visualViewportHeight = undefined;
    visualViewportTop = 0;
    mobileKeyboardInset = 0;
    mobileKeyboardOpen = false;
  };
}

export function isMobileViewport(): boolean {
  return mobileViewport && getMobileModeEnabled();
}

export function setMobileViewport(value: boolean): void {
  mobileViewport = value;
}

export function getMobilePanel(): MobileShellPanel {
  return mobilePanel;
}

export function setMobilePanel(panel: MobileShellPanel): void {
  mobilePanel = panel;
  try {
    globalThis.localStorage.setItem(PANEL_STORAGE_KEY, panel);
  } catch {
    // Keep the selection for this session if storage is blocked or full.
  }
}

export function resetMobileShellState(): void {
  mobileViewport = false;
  mobilePanel = 'preview';
  visualViewportHeight = undefined;
  visualViewportTop = 0;
  mobileKeyboardInset = 0;
  mobileKeyboardOpen = false;
}
