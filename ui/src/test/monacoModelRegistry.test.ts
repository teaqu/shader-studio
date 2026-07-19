import { describe, expect, it, vi } from 'vitest';

import {
  acquireEditorModel,
  acquireEditorModelReference,
  canonicalEditorUri,
  createEditorModelOwner,
  getEditorModelOwnerReferenceCount,
  releaseEditorModel,
} from '../../../monaco/src/modelRegistry';

function createMonaco() {
  const models = new Map<string, ReturnType<typeof model>>();
  function uri(value: string) {
    return { toString: () => value }; 
  }
  function model(value: string, language: string, modelUri: ReturnType<typeof uri>) {
    return {
      uri: modelUri,
      dispose: vi.fn(),
      isDisposed: vi.fn(() => false),
      getLanguageId: vi.fn(() => language),
      getValue: vi.fn(() => value),
    };
  }
  return {
    Uri: {
      parse: vi.fn(uri),
      file: vi.fn((value: string) => uri(`file://${value}`)),
    },
    editor: {
      getModel: vi.fn((modelUri: ReturnType<typeof uri>) => models.get(modelUri.toString()) ?? null),
      createModel: vi.fn((value: string, language: string, modelUri: ReturnType<typeof uri>) => {
        const created = model(value, language, modelUri);
        models.set(modelUri.toString(), created);
        return created;
      }),
      setModelLanguage: vi.fn(),
    },
  };
}

describe('Monaco model registry', () => {
  it('deduplicates localhost, dot-segment, and percent-encoded file URI aliases', () => {
    const monaco = createMonaco();

    const first = canonicalEditorUri(monaco as never, 'file://localhost/project/lib/../main%2Eslang');
    const second = canonicalEditorUri(monaco as never, '/project/main.slang');

    expect(first.toString()).toBe(second.toString());
  });

  it('keeps a shared model alive until its last owner releases it', async () => {
    const monaco = createMonaco();
    const first = acquireEditorModel(monaco as never, '/project/main.glsl', 'one', 'glsl');
    const second = acquireEditorModel(monaco as never, '/project/main.glsl', 'two', 'glsl');

    releaseEditorModel(monaco as never, first);
    await Promise.resolve();
    expect(first.dispose).not.toHaveBeenCalled();

    releaseEditorModel(monaco as never, second);
    await Promise.resolve();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(monaco.editor.createModel).toHaveBeenCalledTimes(1);
  });

  it('tracks live reference counts independently by owner kind and token', async () => {
    const monaco = createMonaco();
    const adapterOwner = createEditorModelOwner('adapter');
    const editorOwner = createEditorModelOwner('editor');
    const adapter = acquireEditorModelReference(monaco as never, '/project/main.slang', '', 'slang', adapterOwner);
    const editor = acquireEditorModelReference(monaco as never, '/project/main.slang', '', 'slang', editorOwner);

    expect(getEditorModelOwnerReferenceCount(monaco as never, adapter.model, { kind: 'adapter' })).toBe(1);
    expect(getEditorModelOwnerReferenceCount(monaco as never, adapter.model, { kind: 'editor' })).toBe(1);
    expect(getEditorModelOwnerReferenceCount(monaco as never, adapter.model, { excludingToken: adapterOwner.token })).toBe(1);

    releaseEditorModel(monaco as never, editor.model, editorOwner);
    expect(getEditorModelOwnerReferenceCount(monaco as never, adapter.model, { kind: 'editor' })).toBe(0);
    expect(adapter.model.dispose).not.toHaveBeenCalled();

    releaseEditorModel(monaco as never, adapter.model, adapterOwner);
    await Promise.resolve();
    expect(adapter.model.dispose).toHaveBeenCalledTimes(1);
  });
});
