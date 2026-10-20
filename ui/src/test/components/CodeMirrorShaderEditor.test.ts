import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { CodeMirrorEditorOptions, ShaderCodeMirrorEditor } from '@shader-studio/codemirror';
import CodeMirrorShaderEditor from '../../lib/components/CodeMirrorShaderEditor.svelte';
import ShaderEditor from '../../lib/components/ShaderEditor.svelte';
import { configureHost, resetHost } from '../../lib/state/hostState.svelte';
import { getFixturePreferences, setFixturePreferences } from '../editor/editorPreferencesFixture.svelte';
import { resetLanguageServiceSettings, setLanguageServiceSettings } from '../../lib/state/languageServiceState.svelte';
import { getEditorSelection, resetEditorSelectionState, setEditorSelection } from '../../lib/state/editorSelectionState.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';
import { applyThemeProfile } from '../../lib/stores/themeStore';

const fixture = vi.hoisted(() => ({
  editors: [] as ShaderCodeMirrorEditor[], options: [] as CodeMirrorEditorOptions[],
  sync: vi.fn(async (_environment: unknown) => {}), dispose: vi.fn(),
  descriptions: vi.fn(),
  statuses: [] as ((status: 'pending' | 'ready' | 'error') => void)[],
  navigation: [] as ((uri: string, line: number, column: number) => void)[],
}));
vi.mock('@shader-studio/codemirror', async importOriginal => {
  const actual = await importOriginal<typeof import('@shader-studio/codemirror')>();
  return { ...actual,
    ShaderCodeMirrorEditor: class extends actual.ShaderCodeMirrorEditor {
      constructor(parent: HTMLElement, options: CodeMirrorEditorOptions) {
        super(parent, options); fixture.editors.push(this); fixture.options.push(options);
      }
    },
    CodeMirrorLanguageService: class {
      syncEnvironment = fixture.sync;
      dispose = fixture.dispose;
      setDescriptionsEnabled = fixture.descriptions;
      constructor(_factory: unknown, status: (status: 'pending' | 'ready' | 'error') => void, options: { onNavigate: (uri: string, line: number, column: number) => void }) {
        fixture.statuses.push(status); fixture.navigation.push(options.onNavigate); status('ready');
      }
      extensions() {
        return [];
      }
    },
  };
});
vi.mock('../../lib/components/MonacoShaderEditor.svelte', async () => ({ default: (await import('./MonacoEditorEngineStub.svelte')).default }));
vi.mock('../../lib/editor/createLanguageServiceFactories', () => ({ createLanguageServiceFactories: () => ({ glsl: vi.fn(), slang: vi.fn(), wgsl: vi.fn() }) }));

let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
const transport = { postMessage: vi.fn(), markEditorDirty: vi.fn(), registerPendingSave: vi.fn(() => vi.fn()), getWorkspaceDocuments: vi.fn(async () => []), onMessage: vi.fn(), dispose: vi.fn(), getType: () => 'web', isConnected: () => true } as unknown as Transport;
const props = { isVisible: true, shaderPath: '/a.glsl', shaderCode: 'void main() {}', transport, displayMode: 'pane' as const };
const latest = () => fixture.editors.at(-1)!;
const options = () => fixture.options.at(-1)!;
const settle = async () => {
  await tick(); await Promise.resolve(); await tick();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fixture.editors.length = 0; fixture.options.length = 0; fixture.statuses.length = 0; fixture.navigation.length = 0;
  vi.clearAllMocks(); fixture.sync.mockResolvedValue(undefined);
  Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn((query: string) => query === 'print' ? { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } : media));
  resetHost(); resetEditorSelectionState(); resetLanguageServiceSettings();
  setFixturePreferences({ fontSize: 14, tabSize: 4, insertSpaces: true, wordWrap: 'off', minimap: false, lineNumbers: 'on' });
  applyThemeProfile('light');
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); resetHost();
});

it('creates a real CodeMirror view and synchronizes authoring context/workspace documents', async () => {
  const view = render(CodeMirrorShaderEditor, props); await settle();
  expect(view.container.querySelector('[data-editor-engine="codemirror"]')).toHaveClass('pane');
  expect(view.getByRole('textbox', { name: 'Shader code' })).toHaveTextContent('void main() {}');
  expect(fixture.sync).toHaveBeenCalledWith(expect.objectContaining({ documentUri: 'file:///a.glsl', workspaceDocuments: [] }));
  expect(view.container.querySelector('[data-language-service-status]')).toHaveAttribute('data-language-service-status', 'ready');
  expect(fixture.editors).toHaveLength(1);
});
it('defaults mobile descriptions off and applies a saved override without recreating the editor', async () => {
  media.matches = true;
  configureHost({ getEditorPreferences: getFixturePreferences });
  render(CodeMirrorShaderEditor, props);
  await settle();
  expect(fixture.descriptions).toHaveBeenLastCalledWith(false);
  setFixturePreferences({ ...getFixturePreferences(), mobileDescriptions: true });
  await settle();
  expect(fixture.descriptions).toHaveBeenLastCalledWith(true);
  expect(fixture.editors).toHaveLength(1);
});
it('persists edits, compiles hot changes, and flushes pending saves on teardown', async () => {
  const compile = vi.fn(); const view = render(CodeMirrorShaderEditor, { ...props, onCodeChange: compile }); await settle();
  latest().insert('// edit\n');
  vi.advanceTimersByTime(15); await settle();
  expect(transport.postMessage).toHaveBeenCalledWith({ type: 'updateShaderSource', payload: { path: '/a.glsl', code: '// edit\nvoid main() {}' } });
  vi.advanceTimersByTime(15);
  expect(compile).toHaveBeenCalledWith('// edit\nvoid main() {}', '/a.glsl');
  latest().insert('pending'); view.unmount();
  expect(transport.postMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ code: expect.stringContaining('pending') }) }));
  expect(fixture.dispose).toHaveBeenCalled(); expect(media.removeEventListener).toHaveBeenCalled();
});
it('uses registered pending saves, save/compile shortcuts, and host wrap preference', async () => {
  configureHost({ getEditorPreferences: getFixturePreferences, setEditorWordWrap: vi.fn() });
  const compile = vi.fn(); render(CodeMirrorShaderEditor, { ...props, onManualCompile: compile }); await settle();
  latest().insert('pending');
  vi.mocked(transport.registerPendingSave!).mock.calls[0][0]();
  options().onSave?.(); options().onCompile?.(); options().onToggleWrap?.();
  expect(transport.postMessage).toHaveBeenCalledWith({ type: 'extensionCommand', payload: { command: 'saveCurrentShader' } });
  expect(compile).toHaveBeenCalledOnce();
});
it('restores shared selections, publishes debug cursor state, and navigates external definitions', async () => {
  setEditorSelection('/a.glsl', 99, { startLineNumber: 1, startColumn: 6, endLineNumber: 1, endColumn: 10 });
  const cursor = vi.fn(); render(CodeMirrorShaderEditor, { ...props, onCursorChange: cursor }); await settle();
  expect(latest().view.state.selection.main.from).toBe(5);
  vi.advanceTimersByTime(150); expect(cursor).toHaveBeenCalledWith(0, 'void main() {}', 'Image');
  latest().view.dispatch({ selection: { anchor: 2 } });
  expect(getEditorSelection('/a.glsl')?.selection.startColumn).toBe(3);
  fixture.navigation[0]('file:///common%20file.glsl', 3, 4);
  expect(transport.postMessage).toHaveBeenCalledWith({ type: 'navigateToBuffer', payload: { shaderPath: '/a.glsl', bufferPath: '/common file.glsl' } });
  expect(getEditorSelection('/common file.glsl')?.selection.startLineNumber).toBe(4);
});
it('switches files, accepts external content without echoing it, and preserves pending edits', async () => {
  const view = render(CodeMirrorShaderEditor, props); await settle();
  latest().insert('pending');
  await view.rerender({ ...props, shaderPath: '/b.wgsl', shaderCode: 'fn main() {}' }); await settle();
  expect(latest().view.state.doc.toString()).toBe('fn main() {}');
  expect(fixture.editors).toHaveLength(1);
  expect(transport.postMessage).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ path: '/a.glsl' }) }));
  latest().view.contentDOM.blur();
  await view.rerender({ ...props, shaderPath: '/b.wgsl', shaderCode: 'host content' }); await settle();
  expect(latest().view.state.doc.toString()).toBe('host content');
});
it('applies settings and themes without recreating the editor', async () => {
  configureHost({ getEditorPreferences: getFixturePreferences });
  render(CodeMirrorShaderEditor, props); await settle();
  setFixturePreferences({ ...getFixturePreferences(), fontSize: 20, tabSize: 2, lineNumbers: 'off', wordWrap: 'on' }); applyThemeProfile('dark'); await settle();
  expect(fixture.editors).toHaveLength(1); expect(latest().view.contentDOM).toHaveClass('cm-lineWrapping');
  expect(latest().view.dom.querySelector('.cm-lineNumbers')).toBeNull();
});
it('disables services and handles initialization failure without preventing editing', async () => {
  const view = render(CodeMirrorShaderEditor, props); await settle();
  fixture.statuses[0]('error'); await settle(); expect(view.getByRole('status')).toHaveTextContent('Language assistance unavailable');
  latest().insert('still editable'); expect(latest().view.state.doc.toString()).toContain('still editable');
  setLanguageServiceSettings({ glslEnabled: false }); await settle(); expect(fixture.dispose).toHaveBeenCalled();
  fixture.sync.mockRejectedValue(new Error('offline')); setLanguageServiceSettings({ glslEnabled: true }); await settle();
  expect(view.getByRole('status')).toHaveTextContent('Language assistance unavailable');
});
it('supports non-shader documents, hidden lifecycle, and missing optional host methods', async () => {
  const view = render(CodeMirrorShaderEditor, { ...props, isVisible: false, shaderPath: '/x.json', transport: { ...transport, getWorkspaceDocuments: undefined, registerPendingSave: undefined } }); await settle();
  expect(fixture.editors).toHaveLength(0);
  await view.rerender({ ...props, shaderPath: '/x.json' }); await settle();
  expect(fixture.statuses).toHaveLength(0); expect(latest().view.state.doc.toString()).toBe(props.shaderCode);
  await view.rerender({ ...props, isVisible: false }); await settle(); expect(view.container.querySelector('.cm-editor')).toBeNull();
});
it('shows the touch toolbar and runs editing commands without dismissing the keyboard', async () => {
  media.matches = true;
  const view = render(CodeMirrorShaderEditor, props); await settle();
  const toolbar = view.getByRole('toolbar', { name: 'Editor options' });
  expect(latest().view.dom.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await fireEvent.click(view.getByRole('button', { name: 'Show keyboard toolbar' }));
  await fireEvent.click(view.getByRole('button', { name: 'More editing options' }));
  const insert = view.getByRole('button', { name: 'Insert ;' });
  await fireEvent.pointerDown(insert); await fireEvent.click(insert);
  expect(latest().view.state.doc.toString()).toContain(';');
  await fireEvent.click(view.getByRole('button', { name: 'Undo' }));
  expect(latest().view.state.doc.toString()).toBe(props.shaderCode);
  const command = vi.spyOn(latest(), 'command');
  await fireEvent.click(view.getByRole('button', { name: 'Indent' }));
  expect(command).toHaveBeenCalledWith('indent');
});
it('defaults phones to CodeMirror and reacts independently to desktop/mobile editor preferences', async () => {
  media.matches = true; configureHost({ getEditorPreferences: getFixturePreferences });
  const view = render(ShaderEditor, props); await settle();
  expect(view.container.querySelector('[data-editor-engine="codemirror"]')).toBeTruthy();
  setFixturePreferences({ ...getFixturePreferences(), mobileEditor: 'monaco', desktopEditor: 'codemirror' }); await settle();
  expect(view.container.querySelector('[data-editor-engine="monaco"]')).toBeTruthy();
  media.matches = false; for (const [name, listener] of media.addEventListener.mock.calls) {
    if (name === 'change') {
      listener();
    }
  } await settle();
  expect(view.container.querySelector('[data-editor-engine="codemirror"]')).toBeTruthy();
});
