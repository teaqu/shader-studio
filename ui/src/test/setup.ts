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
            for (const k of Object.keys(store)) {
              delete store[k];
            }
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

if (typeof globalThis.ImageData === 'undefined') {
  class MockImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = 'srgb';

    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height ?? Math.floor(this.data.length / (this.width * 4));
      }
    }
  }

  globalThis.ImageData = MockImageData as unknown as typeof ImageData;
}

function createMockCanvasGradient(): CanvasGradient {
  return {
    addColorStop: vi.fn(),
  } as unknown as CanvasGradient;
}

function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    bezierCurveTo: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => createMockCanvasGradient()),
    createRadialGradient: vi.fn(() => createMockCanvasGradient()),
    drawImage: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    getImageData: vi.fn(() => new ImageData(1, 1)),
    lineTo: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 }) as TextMetrics),
    moveTo: vi.fn(),
    putImageData: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '#000000',
    font: '',
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '#000000',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: vi.fn((contextId: string) => {
      if (contextId === '2d') {
        return createMockCanvasContext();
      }
      return null;
    }),
  });
}

if (typeof HTMLMediaElement !== 'undefined') {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: vi.fn(() => Promise.resolve()),
  });

  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
}

const monacoContributionLoadState = vi.hoisted(() => ({
  gotoError: 0,
  hover: 0,
}));

(globalThis as any).__monacoContributionLoadState = monacoContributionLoadState;

const monacoMock = {
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
      onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
      onKeyDown: vi.fn(() => ({ dispose: vi.fn() })),
      onDidFocusEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      getOption: vi.fn(() => 0),
      getModel: (() => {
        const model = {
          getLineMaxColumn: vi.fn(() => 80),
          getLineCount: vi.fn(() => 0),
          getLineContent: vi.fn(() => ''),
        };
        return vi.fn(() => model);
      })(),
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
};

// Mock Monaco editor entrypoints — the static import in EditorOverlay.svelte would
// crash jsdom because Monaco depends on browser APIs (canvas, workers, etc.)
vi.mock('monaco-editor', () => monacoMock);
vi.mock('monaco-editor/esm/vs/editor/editor.api', () => monacoMock);
vi.mock('monaco-editor/esm/vs/editor/contrib/gotoError/browser/gotoError', () => {
  monacoContributionLoadState.gotoError += 1;
  return {};
});
vi.mock('monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution', () => {
  monacoContributionLoadState.hover += 1;
  return {};
});

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

// Mock ResizeObserver — not implemented in jsdom. Fires callback immediately with
// a default width of 1000px so components that derive state from width work correctly.
(global as any).ResizeObserver = class {
  private cb: ResizeObserverCallback;
  private width: number;
  constructor(cb: ResizeObserverCallback, width = 1000) {
    this.cb = cb;
    this.width = width;
  }
  observe(target: Element) {
    this.cb([{ contentRect: { width: this.width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
};
