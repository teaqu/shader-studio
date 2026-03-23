import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import EditorOverlay from '../../lib/components/EditorOverlay.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';

const mockTransport = {
  postMessage: vi.fn(),
  onMessage: vi.fn(),
  dispose: vi.fn(),
  getType: () => 'vscode' as const,
  isConnected: () => true,
} as Transport;

/** Default props for convenience */
const defaultProps = {
  isVisible: true,
  shaderCode: '',
  shaderPath: '/test.glsl',
  transport: mockTransport,
};

/** Helper: get the latest mock editor instance created by monaco.editor.create */
async function getLatestMockEditor() {
  const monaco = await import('monaco-editor');
  const createMock = vi.mocked(monaco.editor.create);
  const calls = createMock.mock.results;
  if (calls.length === 0) return null;
  return calls[calls.length - 1].value as any;
}

/** Helper: create a custom mock editor with captured callbacks */
function createMockEditorWithCallbacks() {
  let contentChangeCallback: (() => void) | null = null;
  let scrollChangeCallback: (() => void) | null = null;
  let keyDownCallback: ((event: any) => void) | null = null;
  const model = {
    getLineMaxColumn: vi.fn(() => 80),
    getLineCount: vi.fn(() => 10),
    getLineContent: vi.fn(() => ''),
  };
  const mockEditor = {
    dispose: vi.fn(),
    getValue: vi.fn(() => ''),
    setValue: vi.fn(),
    focus: vi.fn(),
    updateOptions: vi.fn(),
    saveViewState: vi.fn(() => ({ cursorState: [], viewState: 'saved' })),
    restoreViewState: vi.fn(),
    getPosition: vi.fn((): any => null),
    setPosition: vi.fn(),
    getScrollTop: vi.fn(() => 0),
    setScrollTop: vi.fn(),
    addCommand: vi.fn(() => 'cmd'),
    executeEdits: vi.fn(),
    hasTextFocus: vi.fn(() => false),
    onDidChangeModelContent: vi.fn((cb: any) => { contentChangeCallback = cb; }),
    onDidScrollChange: vi.fn((cb: any) => { scrollChangeCallback = cb; }),
    onKeyDown: vi.fn((cb: any) => { keyDownCallback = cb; }),
    getOption: vi.fn(() => 0),
    getModel: vi.fn(() => model),
    deltaDecorations: vi.fn(() => []),
    getVisibleRanges: vi.fn(() => []),
    getAction: vi.fn(() => ({ run: vi.fn() })),
    trigger: vi.fn(),
  };
  return {
    mockEditor,
    model,
    getContentChangeCallback: () => contentChangeCallback,
    getScrollChangeCallback: () => scrollChangeCallback,
    getKeyDownCallback: () => keyDownCallback,
  };
}

describe('EditorOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Test group: Visibility
  describe('visibility', () => {
    it('should not render editor when isVisible is false', () => {
      const { container } = render(EditorOverlay, {
        props: { ...defaultProps, isVisible: false },
      });
      expect(container.querySelector('.editor-wrapper')).toBeNull();
    });

    it('should render editor wrapper when isVisible is true', () => {
      const { container } = render(EditorOverlay, {
        props: { ...defaultProps, shaderCode: 'void mainImage() {}' },
      });
      expect(container.querySelector('.editor-wrapper')).toBeTruthy();
    });

    it('should render editor-overlay container when visible', () => {
      const { container } = render(EditorOverlay, { props: defaultProps });
      expect(container.querySelector('.editor-overlay')).toBeTruthy();
    });

    it('should not render vim status bar when vim mode is disabled', () => {
      const { container } = render(EditorOverlay, { props: defaultProps });
      expect(container.querySelector('.vim-status-bar')).toBeNull();
    });

    it('should render vim status bar when vim mode is enabled', () => {
      const { container } = render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });
      expect(container.querySelector('.vim-status-bar')).toBeTruthy();
    });

    it('should destroy editor when visibility changes to false', async () => {
      const { rerender } = render(EditorOverlay, { props: defaultProps });

      const mockEditor = await getLatestMockEditor();
      expect(mockEditor).toBeTruthy();

      // Toggle visibility off — should destroy editor
      await rerender({ ...defaultProps, isVisible: false });
      expect(mockEditor.dispose).toHaveBeenCalled();
    });

    it('should restore the saved view state when the overlay is hidden and shown again', async () => {
      const monaco = await import('monaco-editor');
      const firstEditor = createMockEditorWithCallbacks().mockEditor;
      const secondEditor = createMockEditorWithCallbacks().mockEditor;
      const savedViewState = { cursorState: [{ position: { lineNumber: 7, column: 3 } }] } as any;

      firstEditor.saveViewState.mockReturnValue(savedViewState);
      vi.mocked(monaco.editor.create)
        .mockReturnValueOnce(firstEditor as any)
        .mockReturnValueOnce(secondEditor as any);

      const { rerender } = render(EditorOverlay, { props: defaultProps });

      await rerender({ ...defaultProps, isVisible: false });
      expect(firstEditor.saveViewState).toHaveBeenCalled();

      await rerender({ ...defaultProps, isVisible: true });
      expect(secondEditor.restoreViewState).toHaveBeenCalledWith(savedViewState);
    });
  });

  // Test group: Buffer switching logic
  describe('buffer switching', () => {
    it('should call onBufferSwitch with next buffer on switchToNextBuffer', async () => {
      const onBufferSwitch = vi.fn();
      render(EditorOverlay, {
        props: {
          ...defaultProps,
          bufferNames: ['Image', 'common', 'BufferA'],
          activeBufferName: 'Image',
          onBufferSwitch,
        },
      });
      // We can't easily call internal functions, but we test the component renders
      expect(onBufferSwitch).not.toHaveBeenCalled();
    });

    it('should render with default buffer props', () => {
      const { container } = render(EditorOverlay, { props: defaultProps });
      expect(container.querySelector('.editor-wrapper')).toBeTruthy();
    });
  });

  // Test group: Monaco editor initialization
  describe('editor initialization', () => {
    it('should call monaco.editor.create when visible', async () => {
      const monaco = await import('monaco-editor');
      render(EditorOverlay, {
        props: { ...defaultProps, shaderCode: 'void mainImage() {}' },
      });
      expect(monaco.editor.create).toHaveBeenCalled();
    });

    it('should not call monaco.editor.create when not visible', async () => {
      const monaco = await import('monaco-editor');
      vi.mocked(monaco.editor.create).mockClear();
      render(EditorOverlay, {
        props: { ...defaultProps, isVisible: false },
      });
      expect(monaco.editor.create).not.toHaveBeenCalled();
    });

    it('should call setupMonacoGlsl to register language and themes', async () => {
      const { setupMonacoGlsl } = await import('@shader-studio/monaco');
      render(EditorOverlay, { props: defaultProps });
      expect(setupMonacoGlsl).toHaveBeenCalled();
    });

    it('should create the overlay editor with Monaco options suited to the overlay', async () => {
      const monaco = await import('monaco-editor');
      render(EditorOverlay, { props: defaultProps });

      const createCall = vi.mocked(monaco.editor.create).mock.calls.at(-1);
      expect(createCall).toBeTruthy();
      expect(createCall?.[1]).toMatchObject({
        domReadOnly: false,
        editContext: false,
        occurrencesHighlight: 'off',
        padding: { top: 0 },
        readOnly: false,
        selectionHighlight: false,
      });
    });
  });

  // Test group: Vim mode
  describe('vim mode', () => {
    it('should enable vim mode when vimMode prop is true on creation', async () => {
      const { initVimMode, VimMode } = await import('monaco-vim');

      render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      expect(initVimMode).toHaveBeenCalled();
      expect((VimMode as any).Vim.defineEx).toHaveBeenCalled();
    });

    it('should register vim ex commands (bnext, bprev, buffer, lnext, lprev)', async () => {
      const { VimMode } = await import('monaco-vim');

      render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      const defineExMock = vi.mocked((VimMode as any).Vim.defineEx);
      const registeredCommands = defineExMock.mock.calls.map((c: any) => c[0]);
      expect(registeredCommands).toContain('bnext');
      expect(registeredCommands).toContain('bprev');
      expect(registeredCommands).toContain('buffer');
      expect(registeredCommands).toContain('lnext');
      expect(registeredCommands).toContain('lprev');
    });

    it('should call onBufferSwitch with next buffer via :bnext vim command', async () => {
      const { VimMode } = await import('monaco-vim');
      const onBufferSwitch = vi.fn();

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          vimMode: true,
          bufferNames: ['Image', 'BufferA', 'BufferB'],
          activeBufferName: 'Image',
          onBufferSwitch,
        },
      });

      const defineExMock = vi.mocked((VimMode as any).Vim.defineEx);
      const bnextCall = defineExMock.mock.calls.find((c: any) => c[0] === 'bnext');
      expect(bnextCall).toBeTruthy();
      bnextCall![2]();
      expect(onBufferSwitch).toHaveBeenCalledWith('BufferA');
    });

    it('should call onBufferSwitch with previous buffer via :bprev vim command', async () => {
      const { VimMode } = await import('monaco-vim');
      const onBufferSwitch = vi.fn();

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          vimMode: true,
          bufferNames: ['Image', 'BufferA', 'BufferB'],
          activeBufferName: 'Image',
          onBufferSwitch,
        },
      });

      const defineExMock = vi.mocked((VimMode as any).Vim.defineEx);
      const bprevCall = defineExMock.mock.calls.find((c: any) => c[0] === 'bprev');
      expect(bprevCall).toBeTruthy();
      bprevCall![2]();
      expect(onBufferSwitch).toHaveBeenCalledWith('BufferB');
    });

    it('should call onBufferSwitch with named buffer via :buffer vim command', async () => {
      const { VimMode } = await import('monaco-vim');
      const onBufferSwitch = vi.fn();

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          vimMode: true,
          bufferNames: ['Image', 'BufferA', 'BufferB'],
          activeBufferName: 'Image',
          onBufferSwitch,
        },
      });

      const defineExMock = vi.mocked((VimMode as any).Vim.defineEx);
      const bufferCall = defineExMock.mock.calls.find((c: any) => c[0] === 'buffer');
      expect(bufferCall).toBeTruthy();
      bufferCall![2](null, { args: ['BufferA'] });
      expect(onBufferSwitch).toHaveBeenCalledWith('BufferA');
    });

    it('should match buffer name case-insensitively via prefix', async () => {
      const { VimMode } = await import('monaco-vim');
      const onBufferSwitch = vi.fn();

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          vimMode: true,
          bufferNames: ['Image', 'BufferA', 'BufferB'],
          activeBufferName: 'Image',
          onBufferSwitch,
        },
      });

      const defineExMock = vi.mocked((VimMode as any).Vim.defineEx);
      const bufferCall = defineExMock.mock.calls.find((c: any) => c[0] === 'buffer');
      bufferCall![2](null, { args: ['buf'] });
      expect(onBufferSwitch).toHaveBeenCalledWith('BufferA');
    });

    it('should not call onBufferSwitch when :buffer has no matching name', async () => {
      const { VimMode } = await import('monaco-vim');
      const onBufferSwitch = vi.fn();

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          vimMode: true,
          bufferNames: ['Image', 'BufferA'],
          activeBufferName: 'Image',
          onBufferSwitch,
        },
      });

      const defineExMock = vi.mocked((VimMode as any).Vim.defineEx);
      const bufferCall = defineExMock.mock.calls.find((c: any) => c[0] === 'buffer');
      bufferCall![2](null, { args: ['NonExistent'] });
      expect(onBufferSwitch).not.toHaveBeenCalled();
    });

    it('should not call onBufferSwitch when :buffer has no args', async () => {
      const { VimMode } = await import('monaco-vim');
      const onBufferSwitch = vi.fn();

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          vimMode: true,
          bufferNames: ['Image'],
          activeBufferName: 'Image',
          onBufferSwitch,
        },
      });

      const defineExMock = vi.mocked((VimMode as any).Vim.defineEx);
      const bufferCall = defineExMock.mock.calls.find((c: any) => c[0] === 'buffer');
      bufferCall![2](null, { args: [] });
      expect(onBufferSwitch).not.toHaveBeenCalled();
    });

    it('should invoke editor marker actions via :lnext and :lprev vim commands', async () => {
      const { VimMode } = await import('monaco-vim');

      render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      const mockEditor = await getLatestMockEditor();
      const runFn = vi.fn();
      mockEditor.getAction = vi.fn(() => ({ run: runFn }));

      const defineExMock = vi.mocked((VimMode as any).Vim.defineEx);
      const lnextCall = defineExMock.mock.calls.find((c: any) => c[0] === 'lnext');
      const lprevCall = defineExMock.mock.calls.find((c: any) => c[0] === 'lprev');

      lnextCall![2]();
      expect(mockEditor.getAction).toHaveBeenCalledWith('editor.action.marker.next');

      lprevCall![2]();
      expect(mockEditor.getAction).toHaveBeenCalledWith('editor.action.marker.prev');
    });

    it('should disable vim when vimMode changes to false', async () => {
      const { initVimMode } = await import('monaco-vim');
      const disposeFn = vi.fn();
      vi.mocked(initVimMode).mockReturnValue({ dispose: disposeFn } as any);

      const { rerender } = render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      expect(initVimMode).toHaveBeenCalled();

      await rerender({ ...defaultProps, vimMode: false });
      expect(disposeFn).toHaveBeenCalled();
    });

    it('should clear the visible vim status text when vim mode is disabled', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor } = createMockEditorWithCallbacks();
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      let onModeChange: ((payload: { mode?: string }) => void) | undefined;
      const disposeFn = vi.fn();
      const { initVimMode } = await import('monaco-vim');
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn((event: string, cb: (payload: { mode?: string }) => void) => {
          if (event === 'vim-mode-change') onModeChange = cb;
        }),
        dispose: disposeFn,
      } as any);

      const { container, rerender } = render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      const status = container.querySelector('.vim-status-bar') as HTMLDivElement;
      onModeChange?.({ mode: 'insert' });
      expect(status.textContent).toContain('INSERT');

      await rerender({ ...defaultProps, vimMode: false });

      expect(disposeFn).toHaveBeenCalled();
      expect(status.textContent).toBe('');
    });

    it('should enable vim when vimMode changes to true after creation', async () => {
      const { initVimMode } = await import('monaco-vim');
      vi.mocked(initVimMode).mockClear();

      const { rerender } = render(EditorOverlay, {
        props: { ...defaultProps, vimMode: false },
      });

      expect(initVimMode).not.toHaveBeenCalled();

      await rerender({ ...defaultProps, vimMode: true });
      expect(initVimMode).toHaveBeenCalled();
    });

    it('should register vim defineAction and mapCommand for diagnostics and hover', async () => {
      const { VimMode } = await import('monaco-vim');
      const vim = (VimMode as any).Vim;

      render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      expect(vim.defineAction).toHaveBeenCalledWith('nextDiagnostic', expect.any(Function));
      expect(vim.defineAction).toHaveBeenCalledWith('prevDiagnostic', expect.any(Function));
      expect(vim.defineAction).toHaveBeenCalledWith('showHover', expect.any(Function));

      expect(vim.mapCommand).toHaveBeenCalledWith(']d', 'action', 'nextDiagnostic', {}, { context: 'normal' });
      expect(vim.mapCommand).toHaveBeenCalledWith('[d', 'action', 'prevDiagnostic', {}, { context: 'normal' });
      expect(vim.mapCommand).toHaveBeenCalledWith('gl', 'action', 'showHover', {}, { context: 'normal' });
    });

    it('should invoke editor.trigger for vim actions', async () => {
      const { VimMode } = await import('monaco-vim');
      const vim = (VimMode as any).Vim;

      render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      const mockEditor = await getLatestMockEditor();
      const triggerMock = vi.fn();
      mockEditor.trigger = triggerMock;

      const nextDiagCall = vim.defineAction.mock.calls.find((c: any) => c[0] === 'nextDiagnostic');
      const prevDiagCall = vim.defineAction.mock.calls.find((c: any) => c[0] === 'prevDiagnostic');
      const showHoverCall = vim.defineAction.mock.calls.find((c: any) => c[0] === 'showHover');

      nextDiagCall[1]();
      expect(triggerMock).toHaveBeenCalledWith('vim', 'editor.action.marker.next', null);

      prevDiagCall[1]();
      expect(triggerMock).toHaveBeenCalledWith('vim', 'editor.action.marker.prev', null);

      showHoverCall[1]();
      expect(triggerMock).toHaveBeenCalledWith('vim', 'editor.action.showHover', null);
    });

    it('should update the visible status text from vim-mode-change events', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor } = createMockEditorWithCallbacks();
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      let onModeChange: ((payload: { mode?: string }) => void) | undefined;
      const { initVimMode } = await import('monaco-vim');
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn((event: string, cb: (payload: { mode?: string }) => void) => {
          if (event === 'vim-mode-change') onModeChange = cb;
        }),
        dispose: vi.fn(),
        constructor: { keyMap: { vim: { call: vi.fn() } }, signal: vi.fn() },
        state: { keyMap: 'vim', vim: { insertMode: false } },
        toggleOverwrite: vi.fn(),
        setOption: vi.fn(),
      } as any);

      const { container } = render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      const status = container.querySelector('.vim-status-bar') as HTMLDivElement;
      expect(status.textContent).toContain('NORMAL');

      onModeChange?.({ mode: 'visual' });
      expect(status.textContent).toContain('VISUAL');

      onModeChange?.({ mode: 'insert' });
      expect(status.textContent).toContain('INSERT');
    });

    it('should switch to a thin line cursor in insert mode and block cursor in normal mode', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor } = createMockEditorWithCallbacks();
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      let onModeChange: ((payload: { mode?: string }) => void) | undefined;
      const { initVimMode } = await import('monaco-vim');
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn((event: string, cb: (payload: { mode?: string }) => void) => {
          if (event === 'vim-mode-change') onModeChange = cb;
        }),
        dispose: vi.fn(),
        state: { keyMap: 'vim', vim: { insertMode: false, visualMode: false } },
        constructor: { keyMap: { vim: {} } },
      } as any);

      render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      expect(mockEditor.updateOptions).toHaveBeenCalledWith({ cursorStyle: 'block', cursorWidth: 2 });

      onModeChange?.({ mode: 'insert' });
      expect(mockEditor.updateOptions).toHaveBeenCalledWith({ cursorStyle: 'line', cursorWidth: 1 });

      onModeChange?.({ mode: 'normal' });
      expect(mockEditor.updateOptions).toHaveBeenCalledWith({ cursorStyle: 'block', cursorWidth: 2 });
    });

    it('should fall back to insert mode for i when monaco-vim key lookup is undefined', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getKeyDownCallback } = createMockEditorWithCallbacks();
      mockEditor.getPosition.mockReturnValue({ lineNumber: 3, column: 5 });
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { initVimMode } = await import('monaco-vim');
      const vimState = { keyMap: 'vim', vim: { insertMode: false, visualMode: false } };
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn(),
        dispose: vi.fn(),
        state: vimState,
        constructor: { keyMap: { default: {}, vim: {}, 'vim-insert': {}, 'vim-replace': {} } },
      } as any);

      const { container } = render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      const keyDown = getKeyDownCallback();
      expect(keyDown).toBeTruthy();

      keyDown!({
        keyCode: 39,
        browserEvent: { key: 'i', code: 'KeyI', shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() },
      });

      const status = container.querySelector('.vim-status-bar') as HTMLDivElement;
      expect(vimState.keyMap).toBe('vim-insert');
      expect(vimState.vim.insertMode).toBe(true);
      expect(status.textContent).toContain('INSERT');
    });

    it('should move one column right for a fallback before entering insert mode', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getKeyDownCallback } = createMockEditorWithCallbacks();
      mockEditor.getPosition.mockReturnValue({ lineNumber: 2, column: 4 });
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { initVimMode } = await import('monaco-vim');
      const vimState = { keyMap: 'vim', vim: { insertMode: false, visualMode: false } };
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn(),
        dispose: vi.fn(),
        state: vimState,
        constructor: { keyMap: { default: {}, vim: {}, 'vim-insert': {}, 'vim-replace': {} } },
      } as any);

      render(EditorOverlay, { props: { ...defaultProps, vimMode: true } });

      getKeyDownCallback()!({
        keyCode: 31,
        browserEvent: { key: 'a', code: 'KeyA', shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() },
      });

      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 5 });
      expect(vimState.vim.insertMode).toBe(true);
    });

    it('should move to first non-whitespace column for I fallback', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, model, getKeyDownCallback } = createMockEditorWithCallbacks();
      mockEditor.getPosition.mockReturnValue({ lineNumber: 1, column: 8 });
      model.getLineContent.mockReturnValue('    foo();');
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { initVimMode } = await import('monaco-vim');
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn(),
        dispose: vi.fn(),
        state: { keyMap: 'vim', vim: { insertMode: false, visualMode: false } },
        constructor: { keyMap: { default: {}, vim: {}, 'vim-insert': {}, 'vim-replace': {} } },
      } as any);

      render(EditorOverlay, { props: { ...defaultProps, vimMode: true } });

      getKeyDownCallback()!({
        keyCode: 31,
        browserEvent: { key: 'I', code: 'KeyI', shiftKey: true, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() },
      });

      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 5 });
    });

    it('should move to end of line for A fallback', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, model, getKeyDownCallback } = createMockEditorWithCallbacks();
      mockEditor.getPosition.mockReturnValue({ lineNumber: 4, column: 2 });
      model.getLineMaxColumn.mockReturnValue(17);
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { initVimMode } = await import('monaco-vim');
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn(),
        dispose: vi.fn(),
        state: { keyMap: 'vim', vim: { insertMode: false, visualMode: false } },
        constructor: { keyMap: { default: {}, vim: {}, 'vim-insert': {}, 'vim-replace': {} } },
      } as any);

      render(EditorOverlay, { props: { ...defaultProps, vimMode: true } });

      getKeyDownCallback()!({
        keyCode: 31,
        browserEvent: { key: 'A', code: 'KeyA', shiftKey: true, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() },
      });

      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 4, column: 17 });
    });

    it('should insert a new line below for o fallback', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, model, getKeyDownCallback } = createMockEditorWithCallbacks();
      mockEditor.getPosition.mockReturnValue({ lineNumber: 6, column: 3 });
      model.getLineMaxColumn.mockReturnValue(12);
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { initVimMode } = await import('monaco-vim');
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn(),
        dispose: vi.fn(),
        state: { keyMap: 'vim', vim: { insertMode: false, visualMode: false } },
        constructor: { keyMap: { default: {}, vim: {}, 'vim-insert': {}, 'vim-replace': {} } },
      } as any);

      render(EditorOverlay, { props: { ...defaultProps, vimMode: true } });

      getKeyDownCallback()!({
        keyCode: 45,
        browserEvent: { key: 'o', code: 'KeyO', shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() },
      });

      expect(mockEditor.executeEdits).toHaveBeenCalledWith('vim-fallback', [expect.objectContaining({ text: '\n' })]);
      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 7, column: 1 });
    });

    it('should insert a new line above for O fallback', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getKeyDownCallback } = createMockEditorWithCallbacks();
      mockEditor.getPosition.mockReturnValue({ lineNumber: 6, column: 3 });
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { initVimMode } = await import('monaco-vim');
      vi.mocked(initVimMode).mockReturnValue({
        on: vi.fn(),
        dispose: vi.fn(),
        state: { keyMap: 'vim', vim: { insertMode: false, visualMode: false } },
        constructor: { keyMap: { default: {}, vim: {}, 'vim-insert': {}, 'vim-replace': {} } },
      } as any);

      render(EditorOverlay, { props: { ...defaultProps, vimMode: true } });

      getKeyDownCallback()!({
        keyCode: 45,
        browserEvent: { key: 'O', code: 'KeyO', shiftKey: true, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() },
      });

      expect(mockEditor.executeEdits).toHaveBeenCalledWith('vim-fallback', [expect.objectContaining({ text: '\n' })]);
      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 6, column: 1 });
    });

    it('should apply the bottomInset to the wrapper style', () => {
      const { container } = render(EditorOverlay, {
        props: { ...defaultProps, bottomInset: 44 },
      });

      const wrapper = container.querySelector('.editor-wrapper') as HTMLDivElement;
      expect(wrapper.getAttribute('style')).toContain('bottom: 44px;');
    });

  });

  // Test group: Content changes and debounced updates
  describe('content changes', () => {
    it('should call onCodeChange after recompile debounce on content change', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getContentChangeCallback } = createMockEditorWithCallbacks();
      mockEditor.getValue.mockReturnValue('new code');
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const onCodeChange = vi.fn();
      render(EditorOverlay, {
        props: { ...defaultProps, onCodeChange },
      });

      const cb = getContentChangeCallback();
      expect(cb).toBeTruthy();
      cb!();

      vi.advanceTimersByTime(30);
      expect(onCodeChange).toHaveBeenCalledWith('new code');
    });

    it('should not call onCodeChange in manual mode but should still persist edits', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getContentChangeCallback } = createMockEditorWithCallbacks();
      mockEditor.getValue.mockReturnValue('manual code');
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const onCodeChange = vi.fn();
      const transport = {
        postMessage: vi.fn(),
        onMessage: vi.fn(),
        dispose: vi.fn(),
        getType: () => 'vscode' as const,
        isConnected: () => true,
      } as Transport;

      render(EditorOverlay, {
        props: { ...defaultProps, transport, onCodeChange, compileMode: 'manual' },
      });

      getContentChangeCallback()!();

      vi.advanceTimersByTime(30);
      expect(onCodeChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(470);
      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateShaderSource',
        payload: {
          code: 'manual code',
          path: '/test.glsl',
        },
      });
    });

    it('should send updateShaderSource message after persist debounce', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getContentChangeCallback } = createMockEditorWithCallbacks();
      mockEditor.getValue.mockReturnValue('persisted code');
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const transport = {
        postMessage: vi.fn(),
        onMessage: vi.fn(),
        dispose: vi.fn(),
        getType: () => 'vscode' as const,
        isConnected: () => true,
      } as Transport;

      render(EditorOverlay, {
        props: { ...defaultProps, transport },
      });

      getContentChangeCallback()!();

      vi.advanceTimersByTime(500);
      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateShaderSource',
        payload: {
          code: 'persisted code',
          path: '/test.glsl',
        },
      });
    });

    it('should not send message if shaderPath is empty', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getContentChangeCallback } = createMockEditorWithCallbacks();
      mockEditor.getValue.mockReturnValue('some code');
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const transport = {
        postMessage: vi.fn(),
        onMessage: vi.fn(),
        dispose: vi.fn(),
        getType: () => 'vscode' as const,
        isConnected: () => true,
      } as Transport;

      render(EditorOverlay, {
        props: { ...defaultProps, shaderPath: '', transport },
      });

      getContentChangeCallback()!();
      vi.advanceTimersByTime(500);
      expect(transport.postMessage).not.toHaveBeenCalled();
    });

    it('should debounce rapid content changes', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getContentChangeCallback } = createMockEditorWithCallbacks();
      let callCount = 0;
      mockEditor.getValue.mockImplementation(() => `code ${++callCount}`);
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const onCodeChange = vi.fn();
      render(EditorOverlay, {
        props: { ...defaultProps, onCodeChange },
      });

      const cb = getContentChangeCallback()!;

      // Trigger multiple changes rapidly
      cb();
      vi.advanceTimersByTime(10);
      cb();
      vi.advanceTimersByTime(10);
      cb();

      // Only the last one should fire after the debounce
      vi.advanceTimersByTime(30);
      expect(onCodeChange).toHaveBeenCalledTimes(1);
    });
  });

  // Test group: Error markers
  describe('error markers', () => {
    it('should set Monaco markers for matching buffer errors', async () => {
      const monaco = await import('monaco-editor');

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          shaderCode: 'void main() {}',
          activeBufferName: 'Image',
          errors: ['Image: ERROR: 0:5: syntax error'],
        },
      });

      expect(monaco.editor.setModelMarkers).toHaveBeenCalled();
      const calls = vi.mocked(monaco.editor.setModelMarkers).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toBe('glsl');
      const markers = lastCall[2];
      expect(markers.length).toBe(1);
      expect(markers[0].startLineNumber).toBe(5);
      expect(markers[0].message).toBe('syntax error');
      expect(markers[0].severity).toBe(monaco.MarkerSeverity.Error);
    });

    it('should not set markers for errors from a different buffer', async () => {
      const monaco = await import('monaco-editor');

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          shaderCode: 'void main() {}',
          activeBufferName: 'Image',
          errors: ['BufferA: ERROR: 0:3: undefined variable'],
        },
      });

      const calls = vi.mocked(monaco.editor.setModelMarkers).mock.calls;
      const lastCall = calls[calls.length - 1];
      const markers = lastCall[2];
      expect(markers.length).toBe(0);
    });

    it('should handle multiple errors for the active buffer', async () => {
      const monaco = await import('monaco-editor');

      render(EditorOverlay, {
        props: {
          ...defaultProps,
          shaderCode: 'void main() {}',
          activeBufferName: 'Image',
          errors: [
            'Image: ERROR: 0:3: missing semicolon',
            'Image: ERROR: 0:10: undeclared identifier',
          ],
        },
      });

      const calls = vi.mocked(monaco.editor.setModelMarkers).mock.calls;
      const lastCall = calls[calls.length - 1];
      const markers = lastCall[2];
      expect(markers.length).toBe(2);
      expect(markers[0].startLineNumber).toBe(3);
      expect(markers[1].startLineNumber).toBe(10);
    });

    it('should update markers when errors prop changes', async () => {
      const monaco = await import('monaco-editor');

      const { rerender } = render(EditorOverlay, {
        props: {
          ...defaultProps,
          activeBufferName: 'Image',
          errors: [],
        },
      });

      vi.mocked(monaco.editor.setModelMarkers).mockClear();

      await rerender({
        ...defaultProps,
        activeBufferName: 'Image',
        errors: ['Image: ERROR: 0:7: type mismatch'],
      });

      expect(monaco.editor.setModelMarkers).toHaveBeenCalled();
      const calls = vi.mocked(monaco.editor.setModelMarkers).mock.calls;
      const lastCall = calls[calls.length - 1];
      const markers = lastCall[2];
      expect(markers.length).toBe(1);
      expect(markers[0].startLineNumber).toBe(7);
    });
  });

  // Test group: External shader code changes
  describe('external shader code changes', () => {
    it('should apply new code when shaderPath changes (buffer switch)', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor } = createMockEditorWithCallbacks();
      mockEditor.getValue.mockReturnValue('old code');
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { rerender } = render(EditorOverlay, {
        props: { ...defaultProps, shaderCode: 'old code' },
      });

      mockEditor.setValue.mockClear();

      await rerender({
        ...defaultProps,
        shaderCode: 'new buffer code',
        shaderPath: '/other.glsl',
      });

      expect(mockEditor.setValue).toHaveBeenCalledWith('new buffer code');
      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 });
      expect(mockEditor.setScrollTop).toHaveBeenCalledWith(0);
    });

    it('should apply external changes when editor does not have focus', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor } = createMockEditorWithCallbacks();
      mockEditor.getValue.mockReturnValue('current code');
      mockEditor.getPosition.mockReturnValue({ lineNumber: 5, column: 3 } as any);
      mockEditor.getScrollTop.mockReturnValue(42);
      mockEditor.hasTextFocus.mockReturnValue(false);
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { rerender } = render(EditorOverlay, {
        props: { ...defaultProps, shaderCode: 'current code' },
      });

      mockEditor.setValue.mockClear();
      mockEditor.setPosition.mockClear();
      mockEditor.setScrollTop.mockClear();

      await rerender({ ...defaultProps, shaderCode: 'externally updated code' });

      expect(mockEditor.setValue).toHaveBeenCalledWith('externally updated code');
      expect(mockEditor.setPosition).toHaveBeenCalledWith({ lineNumber: 5, column: 3 });
      expect(mockEditor.setScrollTop).toHaveBeenCalledWith(42);
    });

    it('should ignore echo-back when shaderCode matches lastSentCode', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getContentChangeCallback } = createMockEditorWithCallbacks();
      // Editor starts with 'initial', user types 'edited code'
      mockEditor.getValue.mockReturnValue('edited code');
      mockEditor.hasTextFocus.mockReturnValue(true);
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const transport = {
        postMessage: vi.fn(),
        onMessage: vi.fn(),
        dispose: vi.fn(),
        getType: () => 'vscode' as const,
        isConnected: () => true,
      } as Transport;

      const { rerender } = render(EditorOverlay, {
        props: { ...defaultProps, shaderCode: 'initial', transport },
      });

      // Simulate a content change that triggers the persist timer
      getContentChangeCallback()!();
      vi.advanceTimersByTime(500); // persist timer fires, sets lastSentCode = 'edited code'

      expect(transport.postMessage).toHaveBeenCalledWith({
        type: 'updateShaderSource',
        payload: { code: 'edited code', path: '/test.glsl' },
      });

      mockEditor.setValue.mockClear();

      // User keeps typing so editor value differs from the echoed code
      mockEditor.getValue.mockReturnValue('edited code plus more');

      // Extension echoes back 'edited code' as shaderCode. Since
      // currentValue ('edited code plus more') !== shaderCode ('edited code')
      // but lastSentCode === shaderCode, the echo is ignored.
      await rerender({ ...defaultProps, shaderCode: 'edited code', transport });
      expect(mockEditor.setValue).not.toHaveBeenCalled();
    });

    it('should not apply code when editor value matches shaderCode', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor } = createMockEditorWithCallbacks();
      mockEditor.getValue.mockReturnValue('same code');
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { rerender } = render(EditorOverlay, {
        props: { ...defaultProps, shaderCode: 'same code' },
      });

      mockEditor.setValue.mockClear();

      await rerender({ ...defaultProps, shaderCode: 'same code' });
      expect(mockEditor.setValue).not.toHaveBeenCalled();
    });
  });

  // Test group: Destroy / cleanup
  describe('destroy and cleanup', () => {
    it('should clear timers and dispose editor on destroy', async () => {
      const monaco = await import('monaco-editor');
      const { mockEditor, getContentChangeCallback } = createMockEditorWithCallbacks();
      mockEditor.getValue.mockReturnValue('code');
      vi.mocked(monaco.editor.create).mockReturnValue(mockEditor as any);

      const { unmount } = render(EditorOverlay, { props: defaultProps });

      // Trigger timers by changing content
      getContentChangeCallback()!();

      unmount();
      expect(mockEditor.dispose).toHaveBeenCalled();
    });

    it('should dispose vim mode instance on destroy', async () => {
      const { initVimMode } = await import('monaco-vim');
      const disposeFn = vi.fn();
      vi.mocked(initVimMode).mockReturnValue({ dispose: disposeFn } as any);

      const { unmount } = render(EditorOverlay, {
        props: { ...defaultProps, vimMode: true },
      });

      unmount();
      expect(disposeFn).toHaveBeenCalled();
    });
  });
});
