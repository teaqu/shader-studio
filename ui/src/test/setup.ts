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
  KeyMod: { Shift: 1024 },
  KeyCode: { KeyA: 31, KeyI: 39, KeyO: 45 },
  Range: class Range {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
      this.startLineNumber = startLineNumber;
      this.startColumn = startColumn;
      this.endLineNumber = endLineNumber;
      this.endColumn = endColumn;
    }
  },
  editor: {
    create: vi.fn(() => ({
      dispose: vi.fn(),
      getValue: vi.fn(() => ''),
      setValue: vi.fn(),
      focus: vi.fn(),
      updateOptions: vi.fn(),
      saveViewState: vi.fn(() => null),
      restoreViewState: vi.fn(),
      getPosition: vi.fn(),
      setPosition: vi.fn(),
      getScrollTop: vi.fn(() => 0),
      setScrollTop: vi.fn(),
      addCommand: vi.fn(() => "cmd"),
      executeEdits: vi.fn(),
      hasTextFocus: vi.fn(() => false),
      onDidChangeModelContent: vi.fn(),
      onDidScrollChange: vi.fn(),
      onKeyDown: vi.fn(() => ({ dispose: vi.fn() })),
      onDidFocusEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      getOption: vi.fn(() => 0),
      getModel: vi.fn(() => ({
        getLineMaxColumn: vi.fn(() => 80),
        getLineCount: vi.fn(() => 0),
        getLineContent: vi.fn(() => ''),
      })),
      deltaDecorations: vi.fn(() => []),
      getVisibleRanges: vi.fn(() => []),
    })),
    EditorOption: { lineHeight: 66, padding: 83 },
    defineTheme: vi.fn(),
    setModelMarkers: vi.fn(),
  },
  languages: {
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    getLanguages: vi.fn(() => []),
  },
}));

// Mock @shader-studio/monaco — delegates to mocked monaco-editor above
vi.mock('@shader-studio/monaco', () => ({
  setupMonacoGlsl: vi.fn(),
  glslLanguageDefinition: {},
  shaderStudioTheme: {},
  shaderStudioTransparentTheme: {},
}));

// Mock monaco-vim — requires browser APIs not available in jsdom
vi.mock('monaco-vim', () => ({
  initVimMode: vi.fn(() => ({
    on: vi.fn(),
    dispose: vi.fn(),
  })),
  VimMode: {
    Vim: {
      defineEx: vi.fn(),
      defineAction: vi.fn(),
      mapCommand: vi.fn(),
    },
  },
}));

// Mock VS Code API
(global as any).acquireVsCodeApi = vi.fn(() => ({
  postMessage: vi.fn(),
  getState: vi.fn(() => ({})),
  setState: vi.fn()
}));
