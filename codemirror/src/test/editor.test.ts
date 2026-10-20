import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forEachDiagnostic, linter } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { completionStatus } from '@codemirror/autocomplete';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShaderCodeMirrorEditor, defaultPreferences } from '../editor';

const editors: ShaderCodeMirrorEditor[] = [];
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});
afterEach(() => {
  while (editors.length) {
    editors.pop()?.dispose();
  }
  document.body.replaceChildren();
});

function createEditor(overrides: Partial<ConstructorParameters<typeof ShaderCodeMirrorEditor>[1]> = {}) {
  const parent = document.body.appendChild(document.createElement('div'));
  const callbacks = { onChange: vi.fn(), onSelection: vi.fn(), onSave: vi.fn(), onCompile: vi.fn(), onToggleWrap: vi.fn() };
  const editor = new ShaderCodeMirrorEditor(parent, { path: 'shader.wgsl', code: 'let source = 1;', ...callbacks, ...overrides });
  editors.push(editor);
  return { editor, callbacks, parent };
}

function key(view: EditorView, init: KeyboardEventInit): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('ShaderCodeMirrorEditor', () => {
  it('lets the line-number and diagnostic gutters scroll with the code', () => {
    const { editor } = createEditor();
    expect(editor.view.dom.querySelector<HTMLElement>('.cm-gutters')?.style.position).toBe('');
    editor.configure({ ...defaultPreferences, lineNumbers: 'off' });
    expect(editor.view.dom.querySelector<HTMLElement>('.cm-gutters')?.style.position).toBe('');
    editor.configure(defaultPreferences);
    expect(editor.view.dom.querySelector('.cm-lineNumbers')).toBeTruthy();
    expect(editor.view.dom.querySelector<HTMLElement>('.cm-gutters')?.style.position).toBe('');
  });

  it('disables automatic completion while retaining manual suggestions and the active service', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const source = vi.fn(() => ({ from: 0, options: [{ label: 'texture' }], validFor: /^\w*$/ }));
    const { editor } = createEditor({ code: 'te', preferences: { ...defaultPreferences, autoSuggestions: false } });
    try {
      editor.setServiceExtensions([], source);
      editor.view.focus();
      editor.view.dispatch({ changes: { from: 2, insert: 'x' }, selection: { anchor: 3 }, userEvent: 'input.type' });
      await vi.advanceTimersByTimeAsync(200);
      expect(source).not.toHaveBeenCalled();
      expect(editor.command('complete')).toBe(true);
      await vi.advanceTimersByTimeAsync(200);
      expect(source).toHaveBeenCalled();
      expect(completionStatus(editor.view.state)).toBe('active');
      editor.configure({ ...defaultPreferences, autoSuggestions: false });
      expect(completionStatus(editor.view.state)).toBeNull();
      source.mockClear();
      editor.configure({ ...defaultPreferences, autoSuggestions: true });
      editor.view.dispatch({ changes: { from: 3, insert: 't' }, selection: { anchor: 4 }, userEvent: 'input.type' });
      await vi.advanceTimersByTimeAsync(200);
      expect(source).toHaveBeenCalled();
      editor.setDocument('other.glsl', 'te');
      expect(completionStatus(editor.view.state)).toBeNull();
    } finally {
      editor.dispose(); vi.useRealTimers();
    }
  });

  it('creates an accessible editable shader view with defaults', () => {
    const { editor, parent } = createEditor();
    expect(editor.view.contentDOM.getAttribute('aria-label')).toBe('Shader code');
    expect(editor.view.state.doc.toString()).toBe('let source = 1;');
    expect(editor.view.state.facet(EditorState.tabSize)).toBe(defaultPreferences.tabSize);
    expect(parent.querySelector('.cm-editor')).toBeTruthy();
  });

  it('reports local edits and selection changes, but never echoes host content', () => {
    const { editor, callbacks } = createEditor();
    editor.insert('start ');
    expect(editor.view.state.doc.toString()).toBe('start let source = 1;');
    expect(callbacks.onChange).toHaveBeenLastCalledWith('start let source = 1;', 'shader.wgsl');
    expect(callbacks.onSelection).toHaveBeenCalled();
    callbacks.onChange.mockClear();
    editor.setDocument('shader.wgsl', editor.view.state.doc.toString());
    editor.setDocument('shader.wgsl', 'host source');
    expect(editor.view.state.doc.toString()).toBe('host source');
    expect(callbacks.onChange).not.toHaveBeenCalled();
  });

  it('retains each file document, selection, scroll position, and independent undo history', () => {
    const { editor } = createEditor();
    editor.insert('A ');
    editor.view.dispatch({ selection: { anchor: 2 } });
    editor.view.scrollDOM.scrollTop = 31;
    editor.view.scrollDOM.scrollLeft = 7;
    editor.setDocument('other.glsl', 'other');
    editor.insert('B ');
    editor.view.dispatch({ selection: { anchor: 1 } });
    editor.setDocument('shader.wgsl', 'A let source = 1;');
    expect(editor.view.state.doc.toString()).toBe('A let source = 1;');
    expect(editor.view.state.selection.main.anchor).toBe(2);
    expect(editor.view.scrollDOM.scrollTop).toBe(31);
    expect(editor.view.scrollDOM.scrollLeft).toBe(7);
    expect(editor.command('undo')).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('let source = 1;');
    editor.setDocument('other.glsl', 'B other');
    expect(editor.command('undo')).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('other');
  });

  it('restores a file language while applying current preferences and clearing its old services', () => {
    const { editor } = createEditor({ code: '@fragment fn main() {}' });
    const oldService = vi.fn();
    editor.setServiceExtensions([EditorView.updateListener.of(oldService)]);
    editor.setDocument('settings.json', '{"value": true}');
    editor.configure({ fontSize: 16, tabSize: 2, insertSpaces: true, wordWrap: 'on', lineNumbers: 'on' });
    oldService.mockClear();
    editor.setDocument('shader.wgsl', '@fragment fn main() {}');
    const classes: string[] = [];
    highlightTree(syntaxTree(editor.view.state), classHighlighter, (_from, _to, value) => classes.push(value));
    expect(classes).toContain('tok-meta');
    expect(editor.view.state.facet(EditorState.tabSize)).toBe(2);
    editor.insert(' ');
    expect(oldService).not.toHaveBeenCalled();
  });

  it('clamps host replacement selections and supports same-file replacement', () => {
    const { editor } = createEditor();
    editor.view.dispatch({ selection: { anchor: 15, head: 3 } });
    editor.setDocument('shader.wgsl', 'tiny');
    expect(editor.view.state.doc.toString()).toBe('tiny');
    expect(editor.view.state.selection.main.anchor).toBe(4);
    expect(editor.view.state.selection.main.head).toBe(3);
    editor.setDocument('shader.wgsl', 'tiny');
    expect(editor.view.state.doc.toString()).toBe('tiny');
  });

  it('reconfigures editor preferences, theme, vim mode, and service extensions', () => {
    const { editor } = createEditor();
    const serviceUpdate = vi.fn();
    editor.setServiceExtensions([EditorView.updateListener.of(serviceUpdate)]);
    editor.configure({ fontSize: 19, tabSize: 2, insertSpaces: false, wordWrap: 'on', lineNumbers: 'off' }, true, true);
    expect(editor.view.state.facet(EditorState.tabSize)).toBe(2);
    expect(editor.view.dom.className).toContain('cm-editor');
    expect(editor.view.dom.querySelector('.cm-lineNumbers')).toBeNull();
    editor.insert('x');
    expect(serviceUpdate).toHaveBeenCalled();
  });

  it('shows host diagnostics alongside language-service linter results', async () => {
    const { editor } = createEditor({ code: 'source' });
    editor.setServiceExtensions([linter(() => [{ from: 1, to: 2, message: 'service warning', severity: 'warning' }])]);
    editor.setDiagnostics([{ from: 3, to: 5, message: 'compiler error', severity: 'error' }]);
    await vi.waitFor(() => {
      const diagnostics: string[] = [];
      forEachDiagnostic(editor.view.state, (diagnostic) => diagnostics.push(diagnostic.message));
      expect(diagnostics).toEqual(expect.arrayContaining(['service warning', 'compiler error']));
    });
    editor.setDiagnostics([]);
    await vi.waitFor(() => {
      const diagnostics: string[] = [];
      forEachDiagnostic(editor.view.state, (diagnostic) => diagnostics.push(diagnostic.message));
      expect(diagnostics).not.toContain('compiler error');
    });
  });

  it('runs keyboard callbacks and editor commands', () => {
    const { editor, callbacks } = createEditor({ code: 'line' });
    key(editor.view, { key: 's', ctrlKey: true });
    key(editor.view, { key: 'Enter', ctrlKey: true });
    key(editor.view, { key: 'z', altKey: true });
    expect(callbacks.onSave).toHaveBeenCalledOnce();
    expect(callbacks.onCompile).toHaveBeenCalledOnce();
    expect(callbacks.onToggleWrap).toHaveBeenCalledOnce();
    expect(editor.command('indent')).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('    line');
    expect(editor.command('outdent')).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('line');
    expect(editor.command('complete')).toBe(true);
    expect(editor.command('search')).toBe(true);
    expect(document.querySelector('.cm-search')).toBeTruthy();
  });

  it('disposes once and prevents lingering view DOM', () => {
    const { editor, parent } = createEditor();
    const destroy = vi.spyOn(editor.view, 'destroy');
    editor.dispose();
    editor.dispose();
    expect(destroy).toHaveBeenCalledOnce();
    expect(parent.querySelector('.cm-editor')).toBeNull();
  });
});

describe('shared CodeMirror documents', () => {
  it('shares text and undo/redo between a pane and overlay without duplicate saves', () => {
    const pane = createEditor({ path: '/shared.glsl', code: 'original' });
    pane.editor.insert('edited ');
    const overlay = createEditor({ path: '/shared.glsl', code: 'original' });
    expect(overlay.editor.view.state.doc.toString()).toBe('edited original');
    overlay.editor.command('undo');
    expect(overlay.editor.view.state.doc.toString()).toBe('original');
    expect(pane.editor.view.state.doc.toString()).toBe('original');
    pane.editor.command('redo');
    expect(overlay.editor.view.state.doc.toString()).toBe('edited original');
    expect(overlay.callbacks.onChange).toHaveBeenCalledTimes(1);
    expect(pane.callbacks.onChange).toHaveBeenCalledTimes(2);
  });
  it('supports Control shortcuts on mobile browsers even when the platform reports a Mac host', () => {
    const { editor } = createEditor({ code: 'whole document' });
    key(editor.view, { key: 'a', ctrlKey: true });
    expect(editor.view.state.selection.main.to).toBe(editor.view.state.doc.length);
    expect(editor.view.state.selection.main.from).toBe(0);
  });
});

it('routes Vim undo and redo through the same history as the toolbar', async () => {
  const { CodeMirror, getCM } = await import('@replit/codemirror-vim');
  const { editor } = createEditor({ path: '/vim-shared.glsl', code: 'original', vim: true });
  editor.insert('edited ');
  const cm = getCM(editor.view)!;
  CodeMirror.commands.undo(cm);
  expect(editor.view.state.doc.toString()).toBe('original');
  CodeMirror.commands.redo(cm);
  expect(editor.view.state.doc.toString()).toBe('edited original');
});

it('preserves Vim history behavior for editors outside Shader Studio', async () => {
  const { CodeMirror, getCM, vim } = await import('@replit/codemirror-vim');
  const { history } = await import('@codemirror/commands');
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ parent, doc: 'a', extensions: [history(), vim()] });
  try {
    view.dispatch({ changes: { from: 1, insert: 'b' } });
    const cm = getCM(view)!;
    CodeMirror.commands.undo(cm);
    expect(view.state.doc.toString()).toBe('a');
    CodeMirror.commands.redo(cm);
    expect(view.state.doc.toString()).toBe('ab');
  } finally {
    view.destroy();
  }
});

it('preserves multiple cursors when undoing edits in a shared document', () => {
  const { editor } = createEditor({ path: '/multi.glsl', code: 'original' });
  editor.view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(8)]) });
  editor.insert('X');
  expect(editor.view.state.doc.toString()).toBe('XoriginalX');
  editor.command('undo');
  expect(editor.view.state.doc.toString()).toBe('original');
  expect(editor.view.state.selection.ranges).toHaveLength(2);
});

it('never lets a peer stale host snapshot replace a shared local edit after blur', () => {
  const pane = createEditor({ path: '/stale.glsl', code: 'original' });
  const peer = createEditor({ path: '/stale.glsl', code: 'original' });
  pane.editor.insert('new ');
  pane.editor.view.contentDOM.blur();
  peer.editor.setDocument('/stale.glsl', 'original');
  expect(pane.editor.view.state.doc.toString()).toBe('new original');
  pane.editor.setDocument('/stale.glsl', 'new original'); // Host acknowledgement.
  peer.editor.setDocument('/stale.glsl', 'original');
  expect(pane.editor.view.state.doc.toString()).toBe('new original');
  peer.editor.setDocument('/stale.glsl', 'external update');
  expect(pane.editor.view.state.doc.toString()).toBe('external update');
});

it('returns to the canonical shared file text when an inactive file changed in another pane', () => {
  const pane = createEditor({ path: '/return.glsl', code: 'original' });
  pane.editor.setDocument('/different.glsl', 'different');
  const peer = createEditor({ path: '/return.glsl', code: 'original' });
  peer.editor.insert('new ');
  peer.editor.view.contentDOM.blur();
  pane.editor.setDocument('/return.glsl', 'original');
  expect(pane.editor.view.state.doc.toString()).toBe('new original');
  expect(peer.editor.view.state.doc.toString()).toBe('new original');
});
