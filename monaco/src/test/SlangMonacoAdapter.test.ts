import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SlangMonacoAdapter, canonicalModelUri } from '../slang/SlangMonacoAdapter';
import type { SlangWorkspaceSnapshot } from '@shader-studio/slang-language-service';
import { SlangPathMap, StaleSlangResultError } from '@shader-studio/slang-language-service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done; 
  });
  return { promise, resolve };
}

function createModel(uri: string, value = '', version = 1) {
  let content = value;
  let currentVersion = version;
  let listener: (() => void) | undefined;
  return {
    uri: { toString: () => uri },
    getValue: vi.fn(() => content),
    setValue: vi.fn((next: string) => {
      content = next; currentVersion += 1; listener?.(); 
    }),
    getVersionId: vi.fn(() => currentVersion),
    onDidChangeContent: vi.fn((next: () => void) => {
      listener = next; return { dispose: vi.fn() }; 
    }),
    isDisposed: vi.fn(() => false),
    dispose: vi.fn(),
    getLanguageId: vi.fn(() => 'slang'),
  };
}

function createMonaco() {
  const models = new Map<string, ReturnType<typeof createModel>>();
  const parse = (value: string) => ({ toString: () => value });
  return {
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    Range: class Range {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
    Uri: { parse: vi.fn(parse) },
    editor: {
      getModel: vi.fn((uri: { toString(): string }) => models.get(uri.toString()) ?? null),
      createModel: vi.fn((source: string, _language: string, uri: { toString(): string }) => {
        const model = createModel(uri.toString(), source);
        models.set(uri.toString(), model);
        return model;
      }),
      setModelMarkers: vi.fn(),
      setModelLanguage: vi.fn(),
    },
    languages: {
      CompletionItemKind: { Text: 0 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      SymbolKind: { File: 0 },
    },
    models,
  };
}

function createClient() {
  return {
    init: vi.fn(async () => undefined),
    replaceFiles: vi.fn(async () => undefined),
    openDocument: vi.fn(async () => undefined),
    changeDocument: vi.fn(async () => undefined),
    closeDocument: vi.fn(async () => undefined),
    completion: vi.fn(async () => []),
    completionResolve: vi.fn(async (_uri, item) => item),
    hover: vi.fn(async () => undefined),
    definition: vi.fn(async () => []),
    signatureHelp: vi.fn(async () => undefined),
    documentSymbols: vi.fn(async () => []),
    diagnostics: vi.fn(async () => []),
    dispose: vi.fn(),
  };
}

const snapshot: SlangWorkspaceSnapshot = {
  rootUri: 'file:///project',
  files: [
    { uri: 'file:///project/main.slang', path: '/workspace/main.slang', source: 'import helper;', version: 3 },
    { uri: 'file:///project/lib/helper.slang', path: '/workspace/lib/helper.slang', source: 'float f(){}', version: 1 },
  ],
};

describe('canonicalModelUri', () => {
  it('normalizes file aliases and percent encoding', () => {
    expect(canonicalModelUri('file://localhost/project/lib/../main%2Eslang')).toBe('file:///project/main.slang');
  });
});

describe('SlangMonacoAdapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates dependency models once and reuses canonical aliases', async () => {
    const monaco = createMonaco();
    const adapter = new SlangMonacoAdapter(monaco as never, createClient());
    await adapter.setWorkspace(snapshot);

    const first = adapter.getOrCreateModel('file:///project/lib/helper.slang');
    const alias = adapter.getOrCreateModel('file://localhost/project/lib/./helper.slang');

    expect(alias).toBe(first);
    expect(monaco.editor.createModel).toHaveBeenCalledTimes(2);
  });

  it('converts canonical transport paths to strict relative language-service paths', async () => {
    const monaco = createMonaco();
    const client = createClient();
    client.init.mockImplementation(async (value) => {
      const strictPaths = new SlangPathMap(value.rootUri);
      for (const file of value.files) {
        strictPaths.register(file.uri, file.path);
      }
    });
    const adapter = new SlangMonacoAdapter(monaco as never, client);

    await adapter.setWorkspace(snapshot);

    expect(client.init).toHaveBeenCalledWith(expect.objectContaining({
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'main.slang' }),
        expect.objectContaining({ path: 'lib/helper.slang' }),
      ]),
    }));
  });

  it('rejects transport paths containing traversal before initializing the worker', async () => {
    const monaco = createMonaco();
    const client = createClient();
    const adapter = new SlangMonacoAdapter(monaco as never, client);

    await expect(adapter.setWorkspace({
      rootUri: 'file:///project',
      files: [{
        uri: 'file:///project/evil.slang',
        path: '/workspace/lib/../evil.slang',
        source: '',
      }],
    })).rejects.toThrow(/traversal/i);
    expect(client.init).not.toHaveBeenCalled();
  });

  it('rejects percent-encoded transport traversal before initializing the worker', async () => {
    const monaco = createMonaco();
    const client = createClient();
    const adapter = new SlangMonacoAdapter(monaco as never, client);

    await expect(adapter.setWorkspace({
      rootUri: 'file:///project',
      files: [{
        uri: 'file:///project/evil.slang',
        path: '/workspace/lib/%2e%2e/evil.slang',
        source: '',
      }],
    })).rejects.toThrow(/traversal/i);
    expect(client.init).not.toHaveBeenCalled();
  });

  it('replaces files for the same root and closes documents before changing roots', async () => {
    const monaco = createMonaco();
    const client = createClient();
    const adapter = new SlangMonacoAdapter(monaco as never, client);
    await adapter.setWorkspace(snapshot);
    await adapter.setWorkspace({ ...snapshot, files: snapshot.files.map((file) => ({ ...file, source: `${file.source}\n` })) });
    await adapter.setWorkspace({
      rootUri: 'file:///other',
      files: [{ uri: 'file:///other/main.slang', path: '/workspace/main.slang', source: 'float4 mainImage(){}' }],
    });

    expect(client.init).toHaveBeenCalledTimes(2);
    expect(client.replaceFiles).toHaveBeenCalledTimes(1);
    expect(client.closeDocument).toHaveBeenCalledWith('file:///project/main.slang', 1);
    expect(client.closeDocument).toHaveBeenCalledWith('file:///project/lib/helper.slang', 1);
  });

  it('converts Monaco one-based positions and Slang zero-based ranges exactly', async () => {
    const monaco = createMonaco();
    const client = createClient();
    client.hover.mockResolvedValue({
      contents: { kind: 'markdown', value: '**float4**' },
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
    });
    const adapter = new SlangMonacoAdapter(monaco as never, client);
    await adapter.setWorkspace(snapshot);
    const model = adapter.getOrCreateModel('file:///project/main.slang')!;

    const result = await adapter.provideHover(model as never, { lineNumber: 2, column: 4 }, { isCancellationRequested: false });

    expect(client.hover).toHaveBeenCalledWith('file:///project/main.slang', { line: 1, character: 3 }, 1);
    expect(result?.range).toEqual(expect.objectContaining({
      startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7,
    }));
  });

  it('opens an unopened dependency model for definition navigation without duplicates', async () => {
    const monaco = createMonaco();
    const client = createClient();
    client.definition.mockResolvedValue([{
      uri: 'file://localhost/project/lib/helper.slang',
      range: { start: { line: 4, character: 1 }, end: { line: 4, character: 2 } },
    }]);
    const adapter = new SlangMonacoAdapter(monaco as never, client);
    await adapter.setWorkspace(snapshot, { createDependencyModels: false });
    const root = adapter.getOrCreateModel('file:///project/main.slang')!;

    const links = await adapter.provideDefinition(root as never, { lineNumber: 1, column: 1 }, { isCancellationRequested: false });

    expect(monaco.editor.createModel).toHaveBeenCalledTimes(2);
    expect(links?.[0].uri.toString()).toBe('file:///project/lib/helper.slang');
    expect(links?.[0].range).toEqual(expect.objectContaining({ startLineNumber: 5, startColumn: 2 }));
  });

  it('drops cancelled and stale asynchronous results', async () => {
    const monaco = createMonaco();
    const client = createClient();
    const pending = deferred<never[]>();
    client.completion.mockReturnValue(pending.promise);
    const adapter = new SlangMonacoAdapter(monaco as never, client);
    await adapter.setWorkspace(snapshot);
    const model = adapter.getOrCreateModel('file:///project/main.slang')!;
    const token = { isCancellationRequested: false };
    const response = adapter.provideCompletionItems(model as never, { lineNumber: 1, column: 1 }, {}, token);
    model.setValue('changed');
    pending.resolve([]);

    expect(await response).toBeUndefined();
    token.isCancellationRequested = true;
    expect(await adapter.provideCompletionItems(model as never, { lineNumber: 1, column: 1 }, {}, token)).toBeUndefined();
  });

  it('turns shared stale-result rejections into dropped Monaco responses', async () => {
    const monaco = createMonaco();
    const client = createClient();
    client.hover.mockRejectedValue(new StaleSlangResultError('file:///project/main.slang', 1, 0));
    const adapter = new SlangMonacoAdapter(monaco as never, client);
    await adapter.setWorkspace(snapshot);
    const model = adapter.getOrCreateModel('file:///project/main.slang')!;

    await expect(adapter.provideHover(
      model as never,
      { lineNumber: 1, column: 1 },
      { isCancellationRequested: false },
    )).resolves.toBeUndefined();
  });

  it('resolves completion data and converts signature help and symbols', async () => {
    const monaco = createMonaco();
    const client = createClient();
    const dto = { label: 'lerp', kind: 3, detail: 'function', data: 'token' };
    client.completion.mockResolvedValue([dto]);
    client.completionResolve.mockResolvedValue({ ...dto, detail: 'resolved' });
    client.signatureHelp.mockResolvedValue({ signatures: [{ label: 'f(float x)', documentation: { kind: 'plaintext', value: 'doc' }, parameters: [{ label: [2, 9], documentation: { kind: 'plaintext', value: 'x' } }] }], activeSignature: 0, activeParameter: 0 });
    client.documentSymbols.mockResolvedValue([{ name: 'f', detail: 'function', kind: 12, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, children: [] }]);
    const adapter = new SlangMonacoAdapter(monaco as never, client);
    await adapter.setWorkspace(snapshot);
    const model = adapter.getOrCreateModel('file:///project/main.slang')!;

    const completion = await adapter.provideCompletionItems(model as never, { lineNumber: 1, column: 1 }, {}, { isCancellationRequested: false });
    const resolved = await adapter.resolveCompletionItem(completion!.suggestions[0], { isCancellationRequested: false });
    const signature = await adapter.provideSignatureHelp(model as never, { lineNumber: 1, column: 1 }, { isCancellationRequested: false });
    const symbols = await adapter.provideDocumentSymbols(model as never, { isCancellationRequested: false });

    expect(resolved.detail).toBe('resolved');
    expect(signature?.value.signatures[0].parameters[0].label).toBe('float x');
    expect(symbols?.[0].selectionRange).toEqual(expect.objectContaining({ startColumn: 7 }));
  });

  it('uses isolated marker owners, clears per model, and drops stale diagnostics', async () => {
    const monaco = createMonaco();
    const client = createClient();
    client.diagnostics.mockResolvedValue([{ code: '1', severity: 1, message: 'bad', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } } }]);
    const adapter = new SlangMonacoAdapter(monaco as never, client);
    await adapter.setWorkspace(snapshot);
    const model = adapter.getOrCreateModel('file:///project/main.slang')!;

    await adapter.refreshDiagnostics(model as never);
    adapter.setCompileMarkers(model as never, []);
    adapter.clearLanguageMarkers(model as never);

    const owners = monaco.editor.setModelMarkers.mock.calls.map((call) => call[1]);
    expect(owners).toContain('slang-language');
    expect(owners).toContain('slang-compile');
    expect(owners).not.toContain('glsl');
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(model, 'slang-language', []);
  });

  it('disposes model listeners, provider registrations, and the client idempotently', async () => {
    const monaco = createMonaco();
    const client = createClient();
    const provider = { dispose: vi.fn() };
    const adapter = new SlangMonacoAdapter(monaco as never, client, [provider]);
    await adapter.setWorkspace(snapshot);

    adapter.dispose();
    adapter.dispose();
    await Promise.resolve();

    expect(provider.dispose).toHaveBeenCalledTimes(1);
    expect(client.dispose).toHaveBeenCalledTimes(1);
    expect([...monaco.models.values()].every((model) => model.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('does not dispose borrowed root or dependency models', async () => {
    const monaco = createMonaco();
    const borrowedRoot = createModel('file:///project/main.slang');
    const borrowedDependency = createModel('file:///project/lib/helper.slang');
    monaco.models.set('file:///project/main.slang', borrowedRoot);
    monaco.models.set('file:///project/lib/helper.slang', borrowedDependency);
    const adapter = new SlangMonacoAdapter(monaco as never, createClient());
    await adapter.setWorkspace(snapshot);
    await adapter.setWorkspace({
      rootUri: 'file:///other',
      files: [{ uri: 'file:///other/main.slang', path: '/workspace/main.slang', source: '' }],
    });
    await Promise.resolve();

    adapter.dispose();

    expect(borrowedRoot.dispose).not.toHaveBeenCalled();
    expect(borrowedDependency.dispose).not.toHaveBeenCalled();
  });

  it('keeps a shared adapter-owned model alive until its final adapter owner releases it', async () => {
    const monaco = createMonaco();
    const first = new SlangMonacoAdapter(monaco as never, createClient());
    const second = new SlangMonacoAdapter(monaco as never, createClient());
    await first.setWorkspace(snapshot);
    await second.setWorkspace(snapshot);
    const shared = monaco.models.get('file:///project/lib/helper.slang')!;

    first.dispose();
    await Promise.resolve();
    expect(shared.dispose).not.toHaveBeenCalled();

    second.dispose();
    await Promise.resolve();
    expect(shared.dispose).toHaveBeenCalledTimes(1);
  });
});
