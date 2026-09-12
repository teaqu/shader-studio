import { describe, expect, it, vi } from "vitest";
import type { LanguageService, ShaderLanguage } from "@shader-studio/language-server-core";
import { MonacoLanguageServiceManager } from "../language-services/MonacoLanguageServiceManager";

function monacoFixture(languageId: ShaderLanguage = "glsl") {
  const disposables: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const disposable = () => {
    const value = { dispose: vi.fn() }; disposables.push(value); return value;
  };
  // Mutable so a test can simulate the user typing while a request is in flight.
  const state = { version: 1 };
  const model = {
    uri: { toString: () => `file:///image.${languageId}` },
    getLanguageId: () => languageId,
    getValue: () => "vec3(1.0, 0.0, 0.0)",
    getVersionId: () => state.version,
    getWordUntilPosition: () => ({ startColumn: 1, endColumn: 1 }),
    onDidChangeContent: vi.fn(() => disposable()),
  };
  const languages = {
    registerCompletionItemProvider: vi.fn(() => disposable()),
    registerHoverProvider: vi.fn(() => disposable()),
    registerDefinitionProvider: vi.fn(() => disposable()),
    registerSignatureHelpProvider: vi.fn(() => disposable()),
    registerDocumentSymbolProvider: vi.fn(() => disposable()),
    registerReferenceProvider: vi.fn(() => disposable()),
    registerDocumentHighlightProvider: vi.fn(() => disposable()),
    registerRenameProvider: vi.fn(() => disposable()),
    registerColorProvider: vi.fn(() => disposable()),
  };
  const models = [model];
  const monaco = {
    languages,
    editor: {
      getModels: () => models,
      getModel: vi.fn((uri: { toString(): string }) => models.find((candidate) => candidate.uri.toString() === uri.toString())),
      createModel: vi.fn((text: string, language: string, uri: { toString(): string }) => {
        const virtual = {
          uri,
          getLanguageId: () => language,
          getValue: () => text,
          setValue: vi.fn(),
          getVersionId: () => 1,
          onDidChangeContent: vi.fn(() => disposable()),
          dispose: vi.fn(),
        };
        models.push(virtual as never);
        return virtual;
      }),
      onDidCreateModel: vi.fn(() => disposable()),
      onWillDisposeModel: vi.fn(() => disposable()),
      setModelMarkers: vi.fn(),
    },
    Uri: { parse: (uri: string) => ({ toString: () => uri }) },
    Range: class {
      constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {}
    },
  };
  return { monaco, model, languages, disposables, state };
}

function serviceFixture(): LanguageService {
  return {
    initialize: vi.fn().mockResolvedValue({}),
    syncEnvironment: vi.fn().mockResolvedValue(undefined),
    openDocument: vi.fn().mockResolvedValue(undefined),
    changeDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    completion: vi.fn().mockResolvedValue([{ label: "normalize", kind: 3 }]),
    hover: vi.fn().mockResolvedValue(null),
    definition: vi.fn().mockResolvedValue([]),
    signatureHelp: vi.fn().mockResolvedValue(null),
    documentSymbols: vi.fn().mockResolvedValue([]),
    diagnostics: vi.fn().mockResolvedValue([]),
    documentColors: vi.fn().mockResolvedValue([]),
    colorPresentations: vi.fn().mockResolvedValue([]),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MonacoLanguageServiceManager", () => {

  const ENVIRONMENT = {
    documentUri: "file:///image.glsl",
    languageId: "glsl" as const,
    generation: 1,
    passName: "Image",
    stage: "fragment" as const,
    customUniforms: [],
    resources: [],
    virtualFiles: [],
  };

  async function providersFor(fixture: ReturnType<typeof monacoFixture>, service: LanguageService) {
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, { glsl: async () => service, slang: async () => service, wgsl: async () => service });
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: fixture.model.uri.toString(), languageId: fixture.model.getLanguageId() });
    return {
      completion: fixture.languages.registerCompletionItemProvider.mock.calls[0][1] as never as {
        provideCompletionItems(model: unknown, position: unknown): Promise<{ incomplete?: boolean; suggestions: { label: string }[] }>;
      },
      hover: fixture.languages.registerHoverProvider.mock.calls[0][1] as never as {
      provideHover(model: unknown, position: unknown): Promise<unknown>;
    },
    };
  }

  const POSITION = { lineNumber: 1, column: 1 };

  it("keeps completions that arrive after the user typed another character", async () => {
    // Quick suggestions request completions on the first keystroke and the user
    // keeps typing while the request is in flight, so guarding the result on the
    // model version discards exactly the list the dropdown needs.
    const fixture = monacoFixture();
    const service = serviceFixture();
    service.completion = vi.fn(async () => {
      fixture.state.version += 1;
      return [{ label: "normalize", kind: 3 }];
    }) as never;
    const { completion } = await providersFor(fixture, service);

    const result = await completion.provideCompletionItems(fixture.model, POSITION);

    expect(result.suggestions.map((item) => item.label)).toEqual(["normalize"]);
    // Monaco re-queries an incomplete list on the next keystroke, so the stale
    // list never becomes the final answer.
    expect(result.incomplete).toBe(true);
  });

  it("retries an empty completion result that a newer document version overtook", async () => {
    const fixture = monacoFixture();
    let syncedVersion = -1;
    const service = serviceFixture();
    service.openDocument = vi.fn(async (doc) => {
      syncedVersion = doc.version;
    }) as never;
    service.changeDocument = vi.fn(async (doc) => {
      syncedVersion = doc.version;
    }) as never;
    service.completion = vi.fn(async (params) => {
      if (vi.mocked(service.completion).mock.calls.length === 1) {
        fixture.state.version += 1;
        return [];
      }
      return params.document.version === syncedVersion ? [{ label: "normalize", kind: 3 }] : [];
    }) as never;
    const { completion } = await providersFor(fixture, service);

    const result = await completion.provideCompletionItems(fixture.model, POSITION);

    expect(service.completion).toHaveBeenCalledTimes(2);
    expect(result.suggestions.map((item) => item.label)).toEqual(["normalize"]);
    expect(result.incomplete).toBe(false);
  });

  it("marks completions complete when the model stood still", async () => {
    const fixture = monacoFixture();
    const { completion } = await providersFor(fixture, serviceFixture());

    const result = await completion.provideCompletionItems(fixture.model, POSITION);

    expect(result.suggestions.map((item) => item.label)).toEqual(["normalize"]);
    expect(result.incomplete).toBe(false);
  });

  it("still drops other results that the model outran", async () => {
    const fixture = monacoFixture();
    const service = serviceFixture();
    service.hover = vi.fn(async () => {
      fixture.state.version += 1;
      return { contents: "vec3" };
    }) as never;
    const { hover } = await providersFor(fixture, service);

    expect(await hover.provideHover(fixture.model, POSITION)).toBeNull();
  });

  it("pins a request's revision to the version it actually synced, not whatever the model reaches by the time sync resolves", async () => {
    // ensureModel's own sync call is itself async. If more keystrokes land
    // while it is in flight, re-reading the model's version afterward to
    // build the request picks up a version the language service was never
    // told about - and because that later read matches the *live* model, the
    // manager's own staleness check sees no mismatch and reports the empty
    // result as final. That silently stops Monaco from ever retrying, which
    // is a worse failure than an honest "stale" - this is the race that
    // dominates in practice, since the real sync call is an IPC/worker round
    // trip far slower than 120ms-apart keystrokes.
    const fixture = monacoFixture();
    let syncedVersion = -1;
    let releaseChangeDocument: (() => void) | undefined;
    let changeDocumentStarted: (() => void) | undefined;
    const changeDocumentStartedPromise = new Promise<void>((resolve) => {
      changeDocumentStarted = resolve;
    });
    const service = serviceFixture();
    service.openDocument = vi.fn(async (doc) => {
      syncedVersion = doc.version;
    }) as never;
    service.changeDocument = vi.fn((doc) => new Promise<void>((resolve) => {
      releaseChangeDocument = () => {
        syncedVersion = doc.version; resolve();
      };
      changeDocumentStarted?.();
    })) as never;
    service.completion = vi.fn(async (params) => (
      params.document.version === syncedVersion ? [{ label: "normalize", kind: 3 }] : []
    )) as never;
    const { completion } = await providersFor(fixture, service);
    expect(syncedVersion).toBe(1);

    fixture.state.version = 2;
    const pending = completion.provideCompletionItems(fixture.model, POSITION);

    // Wait until the request's own sync call is actually in flight (rather
    // than counting microtask ticks, which is what that sync call is made of
    // internally) before more typing happens.
    await changeDocumentStartedPromise;
    fixture.state.version = 3;
    releaseChangeDocument?.();

    const result = await pending;

    expect(result.suggestions.map((item) => item.label)).toEqual(["normalize"]);
    expect(result.incomplete).toBe(true);
  });

  it("syncs an already-open model's latest text before running a request", async () => {
    // Content used to reach the language service only through the
    // onDidChangeContent listener, a separate fire-and-forget task per
    // keystroke. A request built from the model's current version could run
    // before that task's changeDocument landed, so the service still held the
    // previous version and had nothing to answer for the version the request
    // actually asked about - this is what made quick suggestions never open a
    // dropdown while typing, since completion requests fire on the keystroke
    // itself, well before hover or diagnostics would.
    const fixture = monacoFixture();
    let syncedVersion = -1;
    const service = serviceFixture();
    service.openDocument = vi.fn(async (doc) => {
      syncedVersion = doc.version;
    }) as never;
    service.changeDocument = vi.fn(async (doc) => {
      syncedVersion = doc.version;
    }) as never;
    service.completion = vi.fn(async (params) => (
      params.document.version === syncedVersion ? [{ label: "normalize", kind: 3 }] : []
    )) as never;
    const { completion } = await providersFor(fixture, service);
    expect(syncedVersion).toBe(1);

    // The model advances (the user typed) with no explicit changeDocument in
    // between - standing in for the listener's task not having resolved yet.
    fixture.state.version = 2;

    const result = await completion.provideCompletionItems(fixture.model, POSITION);

    expect(result.suggestions.map((item) => item.label)).toEqual(["normalize"]);
    expect(result.incomplete).toBe(false);
    expect(syncedVersion).toBe(2);
  });
  it("registers every provider for GLSL, Slang, and WGSL", () => {
    const { monaco, languages } = monacoFixture();
    const manager = new MonacoLanguageServiceManager(monaco as never, {
      glsl: async () => serviceFixture(),
      slang: async () => serviceFixture(),
      wgsl: async () => serviceFixture(),
    });
    for (const method of ["registerCompletionItemProvider", "registerHoverProvider", "registerDefinitionProvider", "registerSignatureHelpProvider", "registerDocumentSymbolProvider", "registerReferenceProvider", "registerDocumentHighlightProvider", "registerRenameProvider", "registerColorProvider"] as const) {
      expect(languages[method]).toHaveBeenCalledTimes(3);
    }
    manager.dispose();
  });

  it.each(["glsl", "slang", "wgsl"] as const)("lazily opens and independently disables %s", async (language) => {
    const { monaco, model } = monacoFixture(language);
    const services = { glsl: serviceFixture(), slang: serviceFixture(), wgsl: serviceFixture() };
    const manager = new MonacoLanguageServiceManager(monaco as never, {
      glsl: async () => services.glsl,
      slang: async () => services.slang,
      wgsl: async () => services.wgsl,
    });
    const selected = services[language];
    expect(selected.initialize).not.toHaveBeenCalled();
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: model.uri.toString(), languageId: language });
    expect(selected.openDocument).toHaveBeenCalledWith(expect.objectContaining({ uri: model.uri.toString(), languageId: language }));
    for (const other of (["glsl", "slang", "wgsl"] as const).filter(id => id !== language)) {
      expect(services[other].initialize).not.toHaveBeenCalled();
    }
    await manager.setEnabled(language, false);
    expect(selected.dispose).toHaveBeenCalledOnce();
    for (const other of (["glsl", "slang", "wgsl"] as const).filter(id => id !== language)) {
      expect(services[other].dispose).not.toHaveBeenCalled();
    }
    manager.dispose();
  });

  it.each(["glsl", "slang", "wgsl"] as const)("forwards %s diagnostic tags to Monaco markers", async (language) => {
    const fixture = monacoFixture(language);
    const service = serviceFixture();
    vi.mocked(service.diagnostics).mockResolvedValue([{
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
      severity: 2,
      source: `shader-studio-${language}-ls`,
      code: "unused-variable",
      message: "Unused variable 'unused'.",
      tags: [1],
    }]);
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    });
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: fixture.model.uri.toString(), languageId: language });

    const calls = vi.mocked(fixture.monaco.editor.setModelMarkers).mock.calls;
    const markers = calls.find((call) => call[1] === `shader-studio-${language}-ls`)?.[2];
    expect(markers).toEqual([expect.objectContaining({ tags: [1] })]);
    manager.dispose();
  });

  it("creates navigable Monaco models for virtual dependency files", async () => {
    const { monaco } = monacoFixture();
    const manager = new MonacoLanguageServiceManager(monaco as never, { glsl: async () => serviceFixture(), slang: async () => serviceFixture() });
    const environment = { documentUri: "file:///image.glsl", languageId: "glsl" as const, generation: 1, passName: "Image", stage: "fragment" as const, customUniforms: [], resources: [] };

    await manager.syncEnvironment({ ...environment, virtualFiles: [{ uri: "file:///lib/palette.glsl", text: "vec3 palette();", version: 1 }] });

    expect(monaco.editor.createModel).toHaveBeenCalledWith("vec3 palette();", "glsl", expect.objectContaining({}));
    const dependency = monaco.editor.createModel.mock.results[0]?.value;
    await manager.syncEnvironment({ ...environment, generation: 2, virtualFiles: [] });
    expect(dependency?.dispose).toHaveBeenCalledOnce();
  });

  it("registers providers for WGSL like the other shader languages", () => {
    const { monaco, languages } = monacoFixture();
    const manager = new MonacoLanguageServiceManager(monaco as never, {
      glsl: async () => serviceFixture(),
      slang: async () => serviceFixture(),
      wgsl: async () => serviceFixture(),
    });

    expect(languages.registerCompletionItemProvider).toHaveBeenCalledWith("wgsl", expect.anything());
    expect(languages.registerHoverProvider).toHaveBeenCalledWith("wgsl", expect.anything());
    manager.dispose();
  });

  it.each(["glsl", "slang", "wgsl"] as const)("commits %s cross-file rename through the host transaction", async language => {
    const fixture = monacoFixture(language);
    const service = serviceFixture();
    const uri = fixture.model.uri.toString();
    const commonUri = `file:///common.${language}`;
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } };
    service.rename = vi.fn().mockResolvedValue({ changes: {
      [uri]: [{ range, newText: "curve" }], [commonUri]: [{ range, newText: "curve" }],
    } });
    const applyWorkspaceEdit = vi.fn(async (_changes, current, commit) => {
      expect(current()).toBe(true); commit();
    });
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    }, { applyWorkspaceEdit });
    Object.assign(fixture.model, { setValue: vi.fn() });
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: uri, languageId: language,
      virtualFiles: [{ uri: commonUri, text: 'tone', version: 1 }] });
    const provider = fixture.languages.registerRenameProvider.mock.calls.find(call => call[0] === language)![1];
    const result = await provider.provideRenameEdits(fixture.model, POSITION, 'curve');
    expect(result.rejectReason).toBeUndefined();
    expect(applyWorkspaceEdit).toHaveBeenCalledWith([
      { uri, before: 'vec3(1.0, 0.0, 0.0)', after: 'curve(1.0, 0.0, 0.0)' },
      { uri: commonUri, before: 'tone', after: 'curve' },
    ], expect.any(Function), expect.any(Function), new Map([
      [uri, 'vec3(1.0, 0.0, 0.0)'],
      [commonUri, 'tone'],
    ]));
    expect(fixture.model.setValue).toHaveBeenCalledWith('curve(1.0, 0.0, 0.0)');
    manager.dispose();
  });

  for (const language of ['glsl', 'slang', 'wgsl'] as const) {
    it.each(['cancelled', 'stale-source', 'stale-target', 'save-error', 'invalid-range', 'missing-target'])(`${language} rename rejects %s without applying partial model changes`, async mode => {
      const fixture = monacoFixture(language);
      const service = serviceFixture();
      const uri = fixture.model.uri.toString();
      const targetUri = `file:///common.${language}`;
      const token = { isCancellationRequested: false };
      const setValue = vi.fn();
      Object.assign(fixture.model, { setValue });
      const applyWorkspaceEdit = vi.fn(async (_changes, _current, _commit) => {
        throw new Error('save failed');
      });
      const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
        glsl: async () => service, slang: async () => service, wgsl: async () => service,
      }, { applyWorkspaceEdit });
      await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: uri, languageId: language,
        virtualFiles: [{ uri: targetUri, text: 'tone', version: 1 }] });
      service.rename = vi.fn(async () => {
        if (mode === 'cancelled') {
          token.isCancellationRequested = true;
        }
        if (mode === 'stale-source') {
          fixture.state.version++;
        }
        if (mode === 'stale-target') {
          Object.assign(fixture.monaco.editor.getModel(fixture.monaco.Uri.parse(targetUri))!, { getVersionId: () => 2 });
        }
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: mode === 'invalid-range' ? 999 : 4 } };
        return { changes: { [uri]: [{ range, newText: 'curve' }], [mode === 'missing-target' ? 'file:///missing' : targetUri]: [{ range, newText: 'curve' }] } };
      });
      const provider = fixture.languages.registerRenameProvider.mock.calls.find(call => call[0] === language)![1];
      expect((await provider.provideRenameEdits(fixture.model, POSITION, 'curve', token)).rejectReason).toBeTruthy();
      expect(setValue).not.toHaveBeenCalled();
      if (mode !== 'save-error') {
        expect(applyWorkspaceEdit).not.toHaveBeenCalled();
      }
      manager.dispose();
    });
  }

  it.each(['glsl', 'slang', 'wgsl'] as const)('keeps %s environment generations monotonic when a second editor opens the same file', async language => {
    const fixture = monacoFixture(language);
    const service = serviceFixture();
    let generation = 0;
    service.syncEnvironment = vi.fn(async environment => {
      generation = Math.max(generation, environment.generation);
    });
    service.hover = vi.fn(async params => params.document.environmentGeneration === generation ? { contents: 'resolved' } : null);
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    });
    const environment = { ...ENVIRONMENT, documentUri: fixture.model.uri.toString(), languageId: language };
    await manager.syncEnvironment({ ...environment, generation: 7 });
    await manager.syncEnvironment({ ...environment, generation: 1, passName: 'Common' });
    const provider = fixture.languages.registerHoverProvider.mock.calls.find(call => call[0] === language)![1];
    expect(await provider.provideHover(fixture.model, POSITION)).not.toBeNull();
    expect(generation).toBe(8);
    manager.dispose();
  });

  it.each(['glsl', 'slang', 'wgsl'] as const)('waits for the first %s environment before an explicit reference search', async language => {
    const fixture = monacoFixture(language);
    const service = serviceFixture();
    service.references = vi.fn().mockResolvedValue([{ uri: fixture.model.uri.toString(), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } }]);
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, { glsl: async () => service, slang: async () => service, wgsl: async () => service });
    const provider = fixture.languages.registerReferenceProvider.mock.calls.find(call => call[0] === language)![1];
    const pending = provider.provideReferences(fixture.model, POSITION, { includeDeclaration: true });
    await Promise.resolve();
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: fixture.model.uri.toString(), languageId: language });
    expect(await pending).toHaveLength(1);
    expect(service.references).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it.each(['dispose', 'disable', 'close', 'edit', 'deadline'] as const)('ends initial reference waiting on %s without issuing a stale search', async action => {
    vi.useFakeTimers();
    const fixture = monacoFixture();
    const service = serviceFixture();
    service.references = vi.fn().mockResolvedValue([]);
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, { glsl: async () => service, slang: async () => service, wgsl: async () => service });
    try {
      const provider = fixture.languages.registerReferenceProvider.mock.calls.find(call => call[0] === 'glsl')![1];
      const pending = provider.provideReferences(fixture.model, POSITION, { includeDeclaration: true });
      if (action === 'dispose') {
        manager.dispose();
      } else if (action === 'disable') {
        await manager.setEnabled('glsl', false);
      } else if (action === 'close') {
        const disposeModel = fixture.monaco.editor.onWillDisposeModel.mock.calls[0]![0];
        disposeModel(fixture.model);
      } else if (action === 'edit') {
        fixture.state.version++;
        await manager.syncEnvironment(ENVIRONMENT);
      } else {
        await vi.advanceTimersByTimeAsync(5000);
      }
      expect(await pending).toEqual([]);
      expect(service.references).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      manager.dispose();
      vi.useRealTimers();
    }
  });

  it.each(['glsl', 'slang', 'wgsl'] as const)('refreshes unopened %s workspace snapshots before reference search', async language => {
    const fixture = monacoFixture(language);
    const service = serviceFixture();
    const workspaceDocuments = [{ uri: `file:///closed.${language}`, text: 'float tone;', version: 1, stage: 'fragment' as const }];
    const getWorkspaceDocuments = vi.fn(async () => workspaceDocuments);
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    }, { getWorkspaceDocuments });
    service.references = vi.fn(async () => {
      expect(service.syncEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceDocuments }));
      return [];
    });
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: fixture.model.uri.toString(), languageId: language });
    const provider = fixture.languages.registerReferenceProvider.mock.calls.find(call => call[0] === language)![1];
    await provider.provideReferences(fixture.model, POSITION, { includeDeclaration: true });
    expect(getWorkspaceDocuments).toHaveBeenCalledWith(language);
    manager.dispose();
  });

  it.each(["glsl", "slang", "wgsl"] as const)("rejects %s cross-file rename atomically instead of discarding dependency edits", async language => {
    const fixture = monacoFixture(language);
    const service = serviceFixture();
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } };
    service.rename = vi.fn().mockResolvedValue({ changes: {
      [fixture.model.uri.toString()]: [{ range, newText: "curve" }],
      [`file:///common.${language}`]: [{ range, newText: "curve" }],
    } });
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    });
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: fixture.model.uri.toString(), languageId: language });
    const provider = fixture.languages.registerRenameProvider.mock.calls.find(call => call[0] === language)?.[1] as {
      provideRenameEdits(model: unknown, position: unknown, newName: string): Promise<{ edits: unknown[]; rejectReason?: string }>;
    };
    const result = await provider.provideRenameEdits(fixture.model, POSITION, "curve");
    expect(result.edits).toEqual([]);
    expect(result.rejectReason).toContain("across files");
    manager.dispose();
  });
  it.each(["glsl", "slang", "wgsl"] as const)("uses the latest %s environment when worker startup overlaps a rename", async language => {
    const fixture = monacoFixture(language);
    const service = serviceFixture();
    let ready!: () => void;
    service.initialize = vi.fn(() => new Promise(resolve => {
      ready = () => resolve({} as never);
    }));
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } };
    service.rename = vi.fn(async () => ({ changes: { [fixture.model.uri.toString()]: [{ range, newText: "curve" }] } }));
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    });
    const environment = { ...ENVIRONMENT, documentUri: fixture.model.uri.toString(), languageId: language };
    const firstSync = manager.syncEnvironment(environment);
    const provider = fixture.languages.registerRenameProvider.mock.calls.find(call => call[0] === language)![1];
    const pending = provider.provideRenameEdits(fixture.model, { lineNumber: 1, column: 2 }, "curve");
    const latestSync = manager.syncEnvironment({ ...environment, generation: 2 });
    await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
    ready();
    await Promise.all([firstSync, latestSync]);
    expect((await pending).edits).toHaveLength(1);
    expect(service.rename).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ environmentGeneration: 2 }) }));
    manager.dispose();
  });

  it.each(["glsl", "slang", "wgsl"] as const)("declines %s Common declaration rename when dependent files cannot be saved", async language => {
    const fixture = monacoFixture(language);
    const service = serviceFixture();
    service.rename = vi.fn(async () => ({ changes: { [fixture.model.uri.toString()]: [] } }));
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    });
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: fixture.model.uri.toString(), languageId: language, passName: "Common" });
    const provider = fixture.languages.registerRenameProvider.mock.calls.find(call => call[0] === language)![1];
    const result = await provider.provideRenameEdits(fixture.model, { lineNumber: 1, column: 2 }, "curve");
    expect(result.edits).toEqual([]);
    expect(result.rejectReason).toContain("across files");
    expect(service.rename).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("only publishes rename feedback after the request resolves and clears it on success", async () => {
    const fixture = monacoFixture();
    const service = serviceFixture();
    let finish!: (value: null) => void;
    service.rename = vi.fn(() => new Promise(resolve => {
      finish = resolve;
    }));
    const onRenameFeedback = vi.fn();
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    }, { onRenameFeedback });
    await manager.syncEnvironment(ENVIRONMENT);
    const provider = fixture.languages.registerRenameProvider.mock.calls.find(call => call[0] === "glsl")![1];
    const pending = provider.provideRenameEdits(fixture.model, { lineNumber: 1, column: 2 }, "curve");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(onRenameFeedback.mock.calls).toEqual([[fixture.model.uri.toString(), undefined]]);
    finish(null);
    const rejected = await pending;
    expect(onRenameFeedback).toHaveBeenLastCalledWith(fixture.model.uri.toString(), rejected.rejectReason);
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } };
    service.rename = vi.fn(async () => ({ changes: { [fixture.model.uri.toString()]: [{ range, newText: "curve" }] } }));
    await provider.provideRenameEdits(fixture.model, { lineNumber: 1, column: 2 }, "curve");
    expect(onRenameFeedback).toHaveBeenLastCalledWith(fixture.model.uri.toString(), undefined);
    manager.dispose();
  });

  it("prefers open editor buffers over stale workspace snapshot entries", async () => {
    // Another editor holds unsaved text for file B (its env has not synced
    // yet) while the host snapshot still carries the stored copy. Analysis
    // must see the live buffer, with the model's version, not stored text.
    const fixture = monacoFixture();
    const liveText = "float tone(float x) { return x * 2.0; }";
    const other = {
      uri: { toString: () => "file:///other.glsl" },
      getLanguageId: () => "glsl",
      getValue: () => liveText,
      getVersionId: () => 7,
      onDidChangeContent: vi.fn(() => ({ dispose: vi.fn() })),
    };
    (fixture.monaco.editor.getModels as () => unknown[]).call(fixture.monaco.editor).push(other);
    (fixture.monaco as { MarkerSeverity?: unknown }).MarkerSeverity ??= { Error: 8, Hint: 1, Info: 2, Warning: 4 };
    (fixture.monaco.editor as { setModelMarkers?: unknown }).setModelMarkers ??= vi.fn();
    const staleEntry = { uri: "file:///other.glsl", text: "float tone(float x) { return x; }", version: 1000, stage: "fragment" };
    const service = serviceFixture();
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    }, { getWorkspaceDocuments: async () => [staleEntry as never] });
    await manager.syncEnvironment({ ...ENVIRONMENT, documentUri: fixture.model.uri.toString() });
    const sent = vi.mocked(service.syncEnvironment).mock.calls.map(call => call[0]);
    const latest = [...sent].reverse().find(environment => environment.documentUri === fixture.model.uri.toString())!;
    expect(latest.workspaceDocuments).toHaveLength(1);
    expect(latest.workspaceDocuments![0]).toMatchObject({ uri: "file:///other.glsl", text: liveText, version: 7 });
    manager.dispose();
  });

  it("clears obsolete rename feedback when content changes or the manager is disposed", async () => {
    const fixture = monacoFixture();
    const service = serviceFixture();
    service.rename = vi.fn(async () => null);
    const onRenameFeedback = vi.fn();
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, {
      glsl: async () => service, slang: async () => service, wgsl: async () => service,
    }, { onRenameFeedback });
    await manager.syncEnvironment(ENVIRONMENT);
    const provider = fixture.languages.registerRenameProvider.mock.calls.find(call => call[0] === "glsl")![1];
    await provider.provideRenameEdits(fixture.model, { lineNumber: 1, column: 2 }, "curve");
    (fixture.model.onDidChangeContent.mock.calls[0] as unknown as [() => void])[0]();
    expect(onRenameFeedback).toHaveBeenLastCalledWith(fixture.model.uri.toString(), undefined);
    await provider.provideRenameEdits(fixture.model, { lineNumber: 1, column: 2 }, "curve");
    manager.dispose();
    expect(onRenameFeedback).toHaveBeenLastCalledWith(fixture.model.uri.toString(), undefined);
  });

});
