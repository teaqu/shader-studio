import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import ShaderCanvas from '../../lib/components/ShaderCanvas.svelte';
import ShaderEditor from '../../lib/components/ShaderEditor.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';

vi.mock('@shader-studio/monaco', async () => {
  const actual = await vi.importActual<typeof import('@shader-studio/monaco')>('@shader-studio/monaco/scoped-theme');
  return {
    ...actual,
    setupMonacoGlsl: vi.fn(),
    setupMonacoSlang: vi.fn(),
    setupMonacoWgsl: vi.fn(),
    setupMonacoJson: vi.fn(),
    setupMonacoLanguageServices: vi.fn(() => ({
      setEnabled: vi.fn(),
      setColorDecoratorsEnabled: vi.fn(),
      syncEnvironment: vi.fn(),
      dispose: vi.fn(),
    })),
    setCompilerMarkers: vi.fn(),
  };
});

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const mockTransport = {
  postMessage: vi.fn(),
  onMessage: vi.fn(),
  dispose: vi.fn(),
  getType: () => 'web' as const,
  isConnected: () => true,
} as Transport;

/** Wire the mocked Monaco editor to a real textarea standing in for its text input. */
async function mockEditorTextInput() {
  const monaco = await import('monaco-editor');
  const editorApi = monaco.editor as any;
  editorApi.getModel ??= vi.fn(() => undefined);
  editorApi.createModel ??= vi.fn(() => ({
    uri: { toString: () => 'file:///focus-test.glsl' },
    getValue: vi.fn(() => ''),
    getVersionId: vi.fn(() => 1),
  }));
  vi.mocked(editorApi.create).mockImplementation((container: HTMLElement) => {
    const textarea = document.createElement('textarea');
    container.appendChild(textarea);
    let value = '';
    textarea.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        value += event.key;
        textarea.value = value;
      }
    });
    return {
      dispose: vi.fn(),
      getValue: vi.fn(() => value),
      setValue: vi.fn(),
      focus: vi.fn(() => textarea.focus()),
      updateOptions: vi.fn(),
      saveViewState: vi.fn(() => null),
      restoreViewState: vi.fn(),
      getPosition: vi.fn(() => null),
      setPosition: vi.fn(),
      getScrollTop: vi.fn(() => 0),
      setScrollTop: vi.fn(),
      addCommand: vi.fn(() => 'cmd'),
      executeEdits: vi.fn(),
      hasTextFocus: vi.fn(() => document.activeElement === textarea),
      onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
      onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
      onKeyDown: vi.fn(() => ({ dispose: vi.fn() })),
      onDidFocusEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      getOption: vi.fn(() => 0),
      getModel: vi.fn(() => editorApi.createModel()),
      deltaDecorations: vi.fn(() => []),
      getVisibleRanges: vi.fn(() => []),
    };
  });
  return () => document.querySelector('textarea') as HTMLTextAreaElement | null;
}

async function renderEditorAndCanvas() {
  const editorTextInput = await mockEditorTextInput();
  const editorView = render(ShaderEditor, {
    props: { isVisible: true, shaderCode: '', shaderPath: '/focus-test.glsl', transport: mockTransport },
  });
  const canvasView = render(ShaderCanvas, {
    props: {
      zoomLevel: 1.0,
      onCanvasReady: vi.fn(),
      onCanvasResize: vi.fn(),
      onCanvasClick: vi.fn(),
      isInspectorActive: false,
    },
  });
  await tick();
  const canvas = document.querySelector('.canvas-container canvas') as HTMLCanvasElement;
  const canvasContainer = document.querySelector('.canvas-container') as HTMLElement;
  return { editorView, canvasView, editorTextInput, canvas, canvasContainer };
}

/** Type a printable key the way the browser delivers it: to the focused element. */
async function typeKey(key: string) {
  const target = document.activeElement as HTMLElement;
  await fireEvent.keyDown(target, { key });
}

describe('canvas keyboard focus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('moves focus to the canvas on click so keys no longer reach the editor', async () => {
    const { editorTextInput, canvas, canvasContainer } = await renderEditorAndCanvas();
    const editorInput = editorTextInput();
    expect(editorInput).not.toBeNull();
    // The editor focuses its text input on mount: the editor genuinely has focus first.
    expect(document.activeElement).toBe(editorInput);

    await typeKey('a');
    expect(editorInput!.value).toBe('a');

    // The user's path: a real pointer press and click on the actual canvas element.
    await fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100 });
    await fireEvent.click(canvasContainer, { clientX: 100, clientY: 100 });
    expect(document.activeElement).toBe(canvas);

    await typeKey('b');
    expect(editorInput!.value).toBe('a');
  });

  it('still edits the document when the editor is clicked', async () => {
    const { editorTextInput } = await renderEditorAndCanvas();
    const editorInput = editorTextInput();
    editorInput!.focus();
    await typeKey('x');
    expect(editorInput!.value).toBe('x');
  });

  it('edits normally after canvas click followed by editor click', async () => {
    const { editorTextInput, canvas, canvasContainer } = await renderEditorAndCanvas();
    const editorInput = editorTextInput();
    await fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100 });
    await fireEvent.click(canvasContainer, { clientX: 100, clientY: 100 });
    expect(document.activeElement).toBe(canvas);

    // The browser moves focus to the clicked element; the editor takes it back.
    editorInput!.focus();
    await fireEvent.click(editorInput!, { clientX: 10, clientY: 10 });
    await typeKey('y');
    expect(editorInput!.value).toBe('y');
  });
});
