import { describe, expect, it, vi } from "vitest";
import type { LanguageService } from "@shader-studio/language-server-core";
import { MonacoLanguageServiceManager } from "../language-services/MonacoLanguageServiceManager";

function monacoFixture() {
  const disposables: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const disposable = () => { const value = { dispose: vi.fn() }; disposables.push(value); return value; };
  // Mutable so a test can simulate the user typing while a request is in flight.
  const state = { version: 1 };
  const model = {
    uri: { toString: () => "file:///image.glsl" },
    getLanguageId: () => "glsl",
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
    Range: class { constructor(public startLineNumber: number, public startColumn: number, public endLineNumber: number, public endColumn: number) {} },
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
    const manager = new MonacoLanguageServiceManager(fixture.monaco as never, { glsl: async () => service, slang: async () => service });
    await manager.syncEnvironment(ENVIRONMENT);
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
    service.openDocument = vi.fn(async (doc) => { syncedVersion = doc.version; }) as never;
    service.changeDocument = vi.fn(async (doc) => { syncedVersion = doc.version; }) as never;
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
    const changeDocumentStartedPromise = new Promise<void>((resolve) => { changeDocumentStarted = resolve; });
    const service = serviceFixture();
    service.openDocument = vi.fn(async (doc) => { syncedVersion = doc.version; }) as never;
    service.changeDocument = vi.fn((doc) => new Promise<void>((resolve) => {
      releaseChangeDocument = () => { syncedVersion = doc.version; resolve(); };
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
    service.openDocument = vi.fn(async (doc) => { syncedVersion = doc.version; }) as never;
    service.changeDocument = vi.fn(async (doc) => { syncedVersion = doc.version; }) as never;
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
  it("registers every provider for GLSL and Slang", () => {
    const { monaco, languages } = monacoFixture();
    new MonacoLanguageServiceManager(monaco as never, { glsl: async () => serviceFixture(), slang: async () => serviceFixture() });
    for (const method of ["registerCompletionItemProvider", "registerHoverProvider", "registerDefinitionProvider", "registerSignatureHelpProvider", "registerDocumentSymbolProvider", "registerReferenceProvider", "registerDocumentHighlightProvider", "registerRenameProvider", "registerColorProvider"] as const) {
      expect(languages[method]).toHaveBeenCalledTimes(2);
    }
  });

  it("lazily opens models after an environment arrives and disposes independently", async () => {
    const { monaco } = monacoFixture();
    const glsl = serviceFixture();
    const slang = serviceFixture();
    const manager = new MonacoLanguageServiceManager(monaco as never, { glsl: async () => glsl, slang: async () => slang });
    expect(glsl.initialize).not.toHaveBeenCalled();
    await manager.syncEnvironment({ documentUri: "file:///image.glsl", languageId: "glsl", generation: 1, passName: "Image", stage: "fragment", customUniforms: [], resources: [], virtualFiles: [] });
    expect(glsl.openDocument).toHaveBeenCalled();
    expect(slang.initialize).not.toHaveBeenCalled();
    await manager.setEnabled("glsl", false);
    expect(glsl.dispose).toHaveBeenCalledOnce();
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
});
