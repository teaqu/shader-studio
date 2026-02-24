// Test setup: provide minimal browser globals missing in Node/jsdom environments
// Polyfill localStorage if not available or if it doesn't implement getItem/setItem
(
  () => {
    try {
      const g: any = globalThis as any;
      if (!g.localStorage || typeof g.localStorage.getItem !== 'function' || typeof g.localStorage.setItem !== 'function') {
        const store: Record<string, string> = {};
        g.localStorage = {
          getItem(key: string) {
            return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
          },
          setItem(key: string, value: string) {
            store[key] = String(value);
          },
          removeItem(key: string) {
            delete store[key];
          },
          clear() {
            for (const k of Object.keys(store)) delete store[k];
          }
        };
      }
    } catch (e) {
      // Swallow - tests shouldn't fail due to setup
    }
  }
)();
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock monaco-editor — the static import in EditorOverlay.svelte would crash
// jsdom because Monaco depends on browser APIs (canvas, workers, etc.)
vi.mock('monaco-editor', () => ({
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  editor: {
    create: vi.fn(() => ({
      dispose: vi.fn(),
      getValue: vi.fn(() => ''),
      setValue: vi.fn(),
      getPosition: vi.fn(),
      setPosition: vi.fn(),
      getScrollTop: vi.fn(() => 0),
      setScrollTop: vi.fn(),
      hasTextFocus: vi.fn(() => false),
      onDidChangeModelContent: vi.fn(),
      getModel: vi.fn(() => ({
        getLineMaxColumn: vi.fn(() => 80),
      })),
    })),
    defineTheme: vi.fn(),
    setModelMarkers: vi.fn(),
  },
  languages: {
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    getLanguages: vi.fn(() => []),
  },
}));

// Mock monaco-vim — requires browser APIs not available in jsdom
vi.mock('monaco-vim', () => ({
  initVimMode: vi.fn(() => ({
    dispose: vi.fn(),
  })),
  VimMode: {
    Vim: {
      defineEx: vi.fn(),
    },
  },
}));

// Mock VS Code API
(global as any).acquireVsCodeApi = vi.fn(() => ({
  postMessage: vi.fn(),
  getState: vi.fn(() => ({})),
  setState: vi.fn()
}));

// Mock window.piRequestFullScreen for our fullscreen tests
(global as any).piRequestFullScreen = vi.fn();
