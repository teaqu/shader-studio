import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import { createShaderEditor, HostEditorPreferencesController, prefersTouchEditing } from '../../lib/editor/createShaderEditor.svelte';
import { configureHost, resetHost } from '../../lib/state/hostState.svelte';
import { getFixturePreferences, setFixturePreferences } from './editorPreferencesFixture.svelte';

function createEditor() {
  const firstModel = { updateOptions: vi.fn() };
  let model = firstModel;
  const editor = {
    getModel: vi.fn(() => model),
    updateOptions: vi.fn(),
  };
  return { editor, firstModel, setModel: (next: typeof firstModel) => {
    model = next;
  } };
}

describe('HostEditorPreferencesController', () => {
  beforeEach(() => {
    resetHost();
    setFixturePreferences({ fontSize: 14, tabSize: 2, insertSpaces: true, wordWrap: 'off', minimap: false, lineNumbers: 'on' });
  });

  it('is a no-op when the host has no editor preferences', () => {
    const { editor, firstModel } = createEditor();
    const controller = new HostEditorPreferencesController(editor as unknown as ConstructorParameters<typeof HostEditorPreferencesController>[0]);
    expect(editor.updateOptions).not.toHaveBeenCalled();
    expect(firstModel.updateOptions).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('applies live preferences and reapplies model options after a switch', async () => {
    configureHost({ getEditorPreferences: getFixturePreferences });
    const { editor, firstModel, setModel } = createEditor();
    const controller = new HostEditorPreferencesController(editor as unknown as ConstructorParameters<typeof HostEditorPreferencesController>[0]);
    await tick();
    expect(editor.updateOptions).toHaveBeenLastCalledWith({ fontSize: 14, lineHeight: 20, wordWrap: 'off', minimap: { enabled: false }, lineNumbers: 'on' });
    expect(firstModel.updateOptions).toHaveBeenLastCalledWith({ tabSize: 2, insertSpaces: true });

    setFixturePreferences({ fontSize: 18, tabSize: 4, insertSpaces: false, wordWrap: 'on', minimap: true, lineNumbers: 'off' });
    await tick();
    expect(editor.updateOptions).toHaveBeenLastCalledWith({ fontSize: 18, lineHeight: 26, wordWrap: 'on', minimap: { enabled: true }, lineNumbers: 'off' });
    expect(firstModel.updateOptions).toHaveBeenLastCalledWith({ tabSize: 4, insertSpaces: false });

    const secondModel = { updateOptions: vi.fn() };
    setModel(secondModel);
    controller.applyToModel(secondModel as unknown as Parameters<HostEditorPreferencesController['applyToModel']>[0]);
    expect(secondModel.updateOptions).toHaveBeenCalledWith({ tabSize: 4, insertSpaces: false });
    controller.dispose();
  });

  it('stops reacting after disposal', async () => {
    configureHost({ getEditorPreferences: getFixturePreferences });
    const { editor } = createEditor();
    const controller = new HostEditorPreferencesController(editor as unknown as ConstructorParameters<typeof HostEditorPreferencesController>[0]);
    controller.dispose();
    editor.updateOptions.mockClear();
    setFixturePreferences({ fontSize: 17, tabSize: 3, insertSpaces: false, wordWrap: 'on', minimap: true, lineNumbers: 'off' });
    await tick();
    expect(editor.updateOptions).not.toHaveBeenCalled();
  });
});

describe('touch editing', () => {
  function stubPointer(coarse: boolean) {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: coarse && query === '(pointer: coarse)' })));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects a touch-first pointer', () => {
    stubPointer(true);
    expect(prefersTouchEditing()).toBe(true);
    stubPointer(false);
    expect(prefersTouchEditing()).toBe(false);
  });

  it('treats a browser without media queries as a desktop', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersTouchEditing()).toBe(false);
  });

  it.each([[true], [false]])('enables the long-press menu only on touch-first devices (coarse: %s)', (coarse) => {
    stubPointer(coarse);
    const created = createShaderEditor(document.createElement('div'), {
      shaderCode: '', shaderPath: '/touch.glsl', language: 'glsl', theme: 'vs',
    });
    expect(vi.mocked(monaco.editor.create).mock.calls.at(-1)?.[1]).toMatchObject({ contextmenu: coarse });
    created.preferences.dispose();
  });

  it.each([[true], [false]])('shows a horizontal scrollbar for long lines (coarse: %s)', (coarse) => {
    stubPointer(coarse);
    const created = createShaderEditor(document.createElement('div'), {
      shaderCode: '', shaderPath: '/wide.glsl', language: 'glsl', theme: 'vs',
    });
    expect(vi.mocked(monaco.editor.create).mock.calls.at(-1)?.[1]).toMatchObject({
      scrollbar: { vertical: 'hidden', horizontal: 'auto' },
    });
    created.preferences.dispose();
  });
});
