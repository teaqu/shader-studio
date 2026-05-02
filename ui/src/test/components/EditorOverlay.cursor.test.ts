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

const flushMicrotasks = () => new Promise(resolve => queueMicrotask(resolve as () => void));

describe('EditorOverlay — cursor change emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires onCursorChange (via microtask) with 0-based line, lineContent and bufferName', async () => {
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
    await flushMicrotasks();
    expect(onCursorChange).toHaveBeenCalledWith(6, 'float x = 1.0;', 'Image');
  });

  it('fires on every cursor move', async () => {
    const onCursorChange = vi.fn();

    render(EditorOverlay, { props: { ...defaultProps, onCursorChange } });

    const editor = await getLatestMockEditor();
    const [cursorCb] = editor.onDidChangeCursorPosition.mock.calls[0];

    editor.getPosition.mockReturnValue({ lineNumber: 1, column: 1 });
    editor.getModel().getLineContent.mockReturnValue('line1');

    cursorCb({});
    cursorCb({});
    cursorCb({});
    await flushMicrotasks();

    expect(onCursorChange).toHaveBeenCalledTimes(3);
  });

  it('does not throw when onCursorChange prop is not provided', async () => {
    render(EditorOverlay, { props: { ...defaultProps } });

    const editor = await getLatestMockEditor();
    const [cursorCb] = editor.onDidChangeCursorPosition.mock.calls[0];

    editor.getPosition.mockReturnValue({ lineNumber: 1, column: 1 });
    editor.getModel().getLineContent.mockReturnValue('');

    cursorCb({});
    await expect(flushMicrotasks()).resolves.not.toThrow();
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
    await flushMicrotasks();

    expect(onCursorChange).toHaveBeenCalledWith(1, 'float t = iTime;', 'BufferA');
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
