import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import EditorOverlay from '../../lib/components/EditorOverlay.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';

const mockTransport: Transport = {
  postMessage: vi.fn(),
  onMessage: vi.fn(),
  dispose: vi.fn(),
  getType: () => 'vscode' as const,
  isConnected: () => true,
};

const defaultProps = {
  isVisible: true,
  shaderCode: 'void mainImage() {}',
  shaderPath: '/test.glsl',
  transport: mockTransport,
  activeBufferName: 'Image',
};

async function getLatestMockEditor() {
  const monaco = await import('monaco-editor');
  const createMock = vi.mocked(monaco.editor.create);
  const calls = createMock.mock.results;
  return calls.length ? (calls[calls.length - 1].value as any) : null;
}

describe('EditorOverlay — cursor change emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onCursorChange with line, lineContent and bufferName after debounce', async () => {
    const onCursorChange = vi.fn();

    render(EditorOverlay, { props: { ...defaultProps, onCursorChange } });

    const editor = await getLatestMockEditor();
    expect(editor).toBeTruthy();

    const cursorCalls = editor.onDidChangeCursorPosition.mock.calls;
    expect(cursorCalls.length).toBeGreaterThan(0);
    const [cursorCb] = cursorCalls[0];

    editor.getPosition.mockReturnValue({ lineNumber: 7, column: 3 });
    editor.getModel().getLineContent.mockReturnValue('float x = 1.0;');

    cursorCb({});
    expect(onCursorChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30);
    expect(onCursorChange).toHaveBeenCalledWith(7, 'float x = 1.0;', 'Image');
  });

  it('debounces rapid cursor moves into a single call', async () => {
    const onCursorChange = vi.fn();

    render(EditorOverlay, { props: { ...defaultProps, onCursorChange } });

    const editor = await getLatestMockEditor();
    const [cursorCb] = editor.onDidChangeCursorPosition.mock.calls[0];

    editor.getPosition.mockReturnValue({ lineNumber: 1, column: 1 });
    editor.getModel().getLineContent.mockReturnValue('line1');

    cursorCb({});
    vi.advanceTimersByTime(10);
    cursorCb({});
    vi.advanceTimersByTime(10);
    cursorCb({});

    expect(onCursorChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30);
    expect(onCursorChange).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onCursorChange prop is not provided', async () => {
    render(EditorOverlay, { props: { ...defaultProps } });

    const editor = await getLatestMockEditor();
    const [cursorCb] = editor.onDidChangeCursorPosition.mock.calls[0];

    editor.getPosition.mockReturnValue({ lineNumber: 1, column: 1 });
    editor.getModel().getLineContent.mockReturnValue('');

    expect(() => {
      cursorCb({});
      vi.advanceTimersByTime(30);
    }).not.toThrow();
  });

  it('fires with updated bufferName after buffer switch', async () => {
    const onCursorChange = vi.fn();

    const { rerender } = render(EditorOverlay, {
      props: { ...defaultProps, activeBufferName: 'Image', onCursorChange },
    });

    await rerender({ ...defaultProps, activeBufferName: 'BufferA', onCursorChange });

    const editor = await getLatestMockEditor();
    const [cursorCb] = editor.onDidChangeCursorPosition.mock.calls[0];

    editor.getPosition.mockReturnValue({ lineNumber: 2, column: 1 });
    editor.getModel().getLineContent.mockReturnValue('float t = iTime;');

    cursorCb({});
    vi.advanceTimersByTime(30);

    expect(onCursorChange).toHaveBeenCalledWith(2, 'float t = iTime;', 'BufferA');
  });

  it('disposes cursor listener when editor is destroyed', async () => {
    const onCursorChange = vi.fn();

    const { rerender } = render(EditorOverlay, { props: { ...defaultProps, onCursorChange } });

    const editor = await getLatestMockEditor();
    const disposable = editor.onDidChangeCursorPosition.mock.results[0]?.value;
    expect(disposable?.dispose).toBeDefined();

    await rerender({ ...defaultProps, isVisible: false, onCursorChange });

    expect(disposable.dispose).toHaveBeenCalled();
  });
});
