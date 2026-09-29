import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import * as monaco from 'monaco-editor';
import ShaderEditor from '../../lib/components/ShaderEditor.svelte';
import {
  createEditorSelectionSource,
  getEditorSelection,
  resetEditorSelectionState,
  setEditorSelection,
} from '../../lib/state/editorSelectionState.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';

vi.mock('@shader-studio/monaco', async () => ({
  ...(await vi.importActual<typeof import('@shader-studio/monaco')>('@shader-studio/monaco/scoped-theme')),
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
}));

const transport = {
  postMessage: vi.fn(),
  onMessage: vi.fn(),
  dispose: vi.fn(),
  getType: () => 'vscode' as const,
  isConnected: () => true,
} as Transport;

type Selection = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };

const LINE_TWO: Selection = { startLineNumber: 2, startColumn: 11, endLineNumber: 2, endColumn: 11 };

/** Adds the selection and container surface the shared-selection sync uses to the shared Monaco mock. */
function instrumentNextEditor(containerHeight: number) {
  const createEditor = vi.mocked(monaco.editor.create).getMockImplementation()!;
  let selection: Selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
  let emitSelection: ((event: { selection: Selection }) => void) | null = null;
  const appliedToModel: string[] = [];
  let editorInstance: { getModel(): { uri: { toString(): string } } | null } | null = null;
  const surface = {
    getSelection: vi.fn(() => selection),
    setSelection: vi.fn((next: Selection) => {
      appliedToModel.push(editorInstance?.getModel()?.uri.toString() ?? '');
      selection = { ...next };
      emitSelection?.({ selection });
    }),
    // Hidden Monaco editors keep a stale layout height; only the DOM knows.
    getLayoutInfo: vi.fn(() => ({ height: 5 })),
    getContainerDomNode: vi.fn(() => ({ clientHeight: containerHeight })),
    revealPositionInCenterIfOutsideViewport: vi.fn(),
    onDidChangeCursorSelection: vi.fn((listener: typeof emitSelection) => {
      emitSelection = listener;
      return { dispose: vi.fn() };
    }),
  };
  vi.mocked(monaco.editor.create).mockImplementationOnce((...args) => {
    const instance = Object.assign(createEditor(...args), surface);
    editorInstance = instance;
    return instance;
  });
  return {
    surface,
    appliedToModel,
    userSelects: (next: Selection) => {
      selection = { ...next };
      emitSelection?.({ selection });
    },
  };
}

async function renderEditor(containerHeight: number) {
  const editor = instrumentNextEditor(containerHeight);
  const props = { isVisible: true, shaderCode: 'line one\n  return n\n', shaderPath: '/shader.glsl', transport };
  const { rerender } = render(ShaderEditor, { props });
  await tick();
  await tick();
  expect(editor.surface.onDidChangeCursorSelection).toHaveBeenCalled();
  return { ...editor, showShader: async (shaderPath: string) => {
    await rerender({ ...props, shaderPath, shaderCode: 'other one\n  return n\n' });
    await tick();
    await tick();
  } };
}

describe('ShaderEditor shared selection', () => {
  beforeEach(() => {
    resetEditorSelectionState();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetEditorSelectionState();
  });

  it('applies another editor\'s selection and reveals it when this editor is laid out', async () => {
    const { surface } = await renderEditor(300);

    setEditorSelection('/shader.glsl', createEditorSelectionSource(), LINE_TWO);
    await tick();

    expect(surface.setSelection).toHaveBeenCalledWith(LINE_TWO);
    expect(surface.revealPositionInCenterIfOutsideViewport).toHaveBeenCalledWith({ lineNumber: 2, column: 11 });
  });

  it('applies the selection without scrolling while this editor is hidden', async () => {
    // A hidden editor keeps a stale few-pixel layout, so revealing would
    // scroll the top of the document away before it is shown.
    const { surface } = await renderEditor(0);

    setEditorSelection('/shader.glsl', createEditorSelectionSource(), LINE_TWO);
    await tick();

    expect(surface.setSelection).toHaveBeenCalledWith(LINE_TWO);
    expect(surface.revealPositionInCenterIfOutsideViewport).not.toHaveBeenCalled();
  });

  it('does not re-publish a selection it is applying from another editor', async () => {
    const { surface } = await renderEditor(300);
    const other = createEditorSelectionSource();

    setEditorSelection('/shader.glsl', other, LINE_TWO);
    await tick();

    expect(surface.setSelection).toHaveBeenCalledOnce();
    expect(getEditorSelection('/shader.glsl')?.source).toBe(other);
  });

  it('publishes its own selection and does not apply it back to itself', async () => {
    const { surface, userSelects } = await renderEditor(300);

    userSelects(LINE_TWO);
    await tick();

    expect(getEditorSelection('/shader.glsl')?.selection).toEqual(LINE_TWO);
    expect(surface.setSelection).not.toHaveBeenCalled();
  });

  it('leaves an identical selection alone', async () => {
    const { surface, userSelects } = await renderEditor(300);
    userSelects(LINE_TWO);

    setEditorSelection('/shader.glsl', createEditorSelectionSource(), LINE_TWO);
    await tick();

    expect(surface.setSelection).not.toHaveBeenCalled();
    expect(surface.revealPositionInCenterIfOutsideViewport).not.toHaveBeenCalled();
  });

  it('ignores selections for other documents', async () => {
    const { surface } = await renderEditor(300);

    setEditorSelection('/other.glsl', createEditorSelectionSource(), LINE_TWO);
    await tick();

    expect(surface.setSelection).not.toHaveBeenCalled();
  });

  it('waits for the selected document\'s model instead of moving the previous document\'s cursor', async () => {
    const { surface, appliedToModel, showShader } = await renderEditor(300);
    setEditorSelection('/next.glsl', createEditorSelectionSource(), LINE_TWO);
    await tick();
    expect(surface.setSelection).not.toHaveBeenCalled();

    await showShader('/next.glsl');

    expect(appliedToModel).toEqual([monaco.Uri.file('/next.glsl').toString()]);
  });
});
