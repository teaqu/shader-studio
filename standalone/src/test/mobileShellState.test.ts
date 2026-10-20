import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMobilePanel,
  isMobileViewport,
  resetMobileShellState,
  setMobilePanel,
  setMobileViewport,
  getMobileVisualViewportHeight,
  getMobileVisualViewportTop,
  getMobileKeyboardInset,
  isMobileKeyboardOpen,
  observeMobileVisualViewport,
} from '../state/mobileShellState.svelte';

const PANEL_STORAGE_KEY = 'shader-studio.mobile-panel';

beforeEach(() => {
  localStorage.removeItem(PANEL_STORAGE_KEY);
});

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); resetMobileShellState(); document.body.replaceChildren();
  localStorage.removeItem(PANEL_STORAGE_KEY);
});

it('tracks the iPhone keyboard viewport, ignores pinch zoom, and releases its listeners', () => {
  const viewport = Object.assign(new EventTarget(), { scale: 1, height: window.innerHeight, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  const stop = observeMobileVisualViewport();
  const editor = document.body.appendChild(document.createElement('div'));
  editor.dataset.editorEngine = 'codemirror';
  const input = editor.appendChild(document.createElement('textarea'));
  input.focus();
  viewport.height = window.innerHeight - 250;
  viewport.dispatchEvent(new Event('resize'));
  expect(isMobileKeyboardOpen()).toBe(true);
  expect(getMobileVisualViewportHeight()).toBe(viewport.height);
  expect(getMobileKeyboardInset()).toBe(250);
  viewport.offsetTop = 20;
  viewport.dispatchEvent(new Event('scroll'));
  expect(getMobileVisualViewportHeight()).toBe(viewport.height);
  expect(getMobileVisualViewportTop()).toBe(20);
  expect(getMobileKeyboardInset()).toBe(230);
  expect(getMobileVisualViewportTop() + getMobileVisualViewportHeight()! + getMobileKeyboardInset()).toBe(window.innerHeight);
  viewport.scale = 2;
  viewport.dispatchEvent(new Event('resize'));
  expect(getMobileVisualViewportHeight()).toBeUndefined();
  expect(getMobileKeyboardInset()).toBe(0);
  expect(getMobileVisualViewportTop()).toBe(0);
  expect(isMobileKeyboardOpen()).toBe(false);
  viewport.scale = 1;
  viewport.dispatchEvent(new Event('resize'));
  input.blur();
  expect(isMobileKeyboardOpen()).toBe(true);
  viewport.height = window.innerHeight;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event('resize'));
  expect(isMobileKeyboardOpen()).toBe(false);
  stop();
  viewport.dispatchEvent(new Event('resize'));
  expect(getMobileVisualViewportHeight()).toBeUndefined();
  expect(getMobileVisualViewportTop()).toBe(0);
});

it('keeps navigation hidden when innerHeight also shrinks and focus briefly leaves the editor', () => {
  vi.stubGlobal('innerHeight', 800);
  const viewport = Object.assign(new EventTarget(), { scale: 1, height: 800, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  const stop = observeMobileVisualViewport();
  const editor = document.body.appendChild(document.createElement('div'));
  editor.dataset.editorEngine = 'codemirror';
  const input = editor.appendChild(document.createElement('textarea'));
  input.focus();
  expect(isMobileKeyboardOpen()).toBe(false);
  vi.stubGlobal('innerHeight', 400);
  viewport.height = 400;
  viewport.offsetTop = 120;
  viewport.dispatchEvent(new Event('resize'));
  expect(getMobileVisualViewportHeight()).toBe(400);
  expect(getMobileKeyboardInset()).toBe(280);
  expect(getMobileVisualViewportTop()).toBe(120);
  expect(isMobileKeyboardOpen()).toBe(true);
  input.blur();
  expect(isMobileKeyboardOpen()).toBe(true);
  // A browser pan changes the visible origin, not the bottom of the page.
  viewport.offsetTop = 180;
  viewport.dispatchEvent(new Event('scroll'));
  expect(getMobileVisualViewportTop()).toBe(180);
  expect(getMobileVisualViewportHeight()).toBe(400);
  expect(getMobileKeyboardInset()).toBe(220);
  expect(getMobileVisualViewportTop() + getMobileVisualViewportHeight()! + getMobileKeyboardInset()).toBe(800);
  vi.stubGlobal('innerHeight', 800);
  viewport.height = 800;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event('resize'));
  expect(isMobileKeyboardOpen()).toBe(false);
  expect(getMobileKeyboardInset()).toBe(0);
  stop();
});

it('does not add space below the page when keyboard panning changes the visible bottom', () => {
  vi.stubGlobal('innerHeight', 800);
  const viewport = Object.assign(new EventTarget(), { scale: 1, height: 800, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  const stop = observeMobileVisualViewport();
  const editor = document.body.appendChild(document.createElement('div'));
  editor.dataset.editorEngine = 'codemirror';
  editor.appendChild(document.createElement('textarea')).focus();
  viewport.height = 400;
  for (const top of [0, 100, 160, 400]) {
    viewport.offsetTop = top;
    viewport.dispatchEvent(new Event('resize'));
    expect(isMobileKeyboardOpen()).toBe(true);
    expect(getMobileKeyboardInset()).toBe(400 - top);
    expect(getMobileVisualViewportTop() + getMobileVisualViewportHeight()! + getMobileKeyboardInset()).toBe(800);
  }
  viewport.offsetTop = 450;
  viewport.dispatchEvent(new Event('scroll'));
  expect(getMobileKeyboardInset()).toBe(0);
  stop();
});

it('does not mistake rotation or an unrelated focused field for the editor keyboard', () => {
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('innerWidth', 390);
  const viewport = Object.assign(new EventTarget(), { scale: 1, height: 800, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  const stop = observeMobileVisualViewport();
  vi.stubGlobal('innerWidth', 844);
  vi.stubGlobal('innerHeight', 390);
  viewport.height = 390;
  window.dispatchEvent(new Event('resize'));
  const editor = document.body.appendChild(document.createElement('div'));
  editor.dataset.editorEngine = 'codemirror';
  const input = editor.appendChild(document.createElement('textarea'));
  input.focus();
  expect(isMobileKeyboardOpen()).toBe(false);
  input.blur();
  const other = document.body.appendChild(document.createElement('input'));
  other.focus();
  viewport.height = 180;
  viewport.dispatchEvent(new Event('resize'));
  expect(isMobileKeyboardOpen()).toBe(false);
  stop();
});

it('keeps the normal layout when visual viewport information is unavailable', () => {
  vi.stubGlobal('visualViewport', undefined);
  const stop = observeMobileVisualViewport();
  expect(getMobileVisualViewportHeight()).toBeUndefined();
  expect(isMobileKeyboardOpen()).toBe(false);
  stop();
});

describe('mobile shell state', () => {
  it.each(['explorer', 'files', 'editor', 'preview', 'tools'] as const)(
    'restores the %s destination when the app reloads',
    async panel => {
      setMobilePanel(panel);
      expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBe(panel);
      vi.resetModules();
      const reloaded = await import('../state/mobileShellState.svelte');
      expect(reloaded.getMobilePanel()).toBe(panel);
      expect(reloaded.isMobileViewport()).toBe(false);
    },
  );

  it.each([null, '', 'unknown', '{"panel":"editor"}'])(
    'defaults to Preview when the saved destination is %s',
    async saved => {
      if (saved !== null) {
        localStorage.setItem(PANEL_STORAGE_KEY, saved);
      }
      vi.resetModules();
      const reloaded = await import('../state/mobileShellState.svelte');
      expect(reloaded.getMobilePanel()).toBe('preview');
    },
  );

  it('still navigates when browser storage cannot be read or written', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    vi.resetModules();
    const reloaded = await import('../state/mobileShellState.svelte');
    expect(reloaded.getMobilePanel()).toBe('preview');
    expect(() => reloaded.setMobilePanel('editor')).not.toThrow();
    expect(reloaded.getMobilePanel()).toBe('editor');
  });

  it('keeps the selected panel when storage is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    expect(() => setMobilePanel('files')).not.toThrow();
    expect(getMobilePanel()).toBe('files');
  });

  it('keeps phone navigation separate from the desktop layout and restores Preview by default', () => {
    resetMobileShellState();

    expect(isMobileViewport()).toBe(false);
    expect(getMobilePanel()).toBe('preview');

    setMobileViewport(true);
    setMobilePanel('editor');
    expect(getMobilePanel()).toBe('editor');

    setMobileViewport(false);
    expect(getMobilePanel()).toBe('editor');

    resetMobileShellState();
    expect(getMobilePanel()).toBe('preview');
  });
});
