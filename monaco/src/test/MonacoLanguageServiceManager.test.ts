import { describe, expect, it, vi } from "vitest";
import type { LanguageService } from "@shader-studio/language-server-core";
import { MonacoLanguageServiceManager } from "../language-services/MonacoLanguageServiceManager";

function monacoFixture() {
  const disposables: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const disposable = () => { const value = { dispose: vi.fn() }; disposables.push(value); return value; };
  const model = {
    uri: { toString: () => "file:///image.glsl" },
    getLanguageId: () => "glsl",
    getValue: () => "vec3(1.0, 0.0, 0.0)",
    getVersionId: () => 1,
    onDidChangeContent: vi.fn(() => disposable()),
  };
  const languages = {
    registerCompletionItemProvider: vi.fn(() => disposable()),
    registerHoverProvider: vi.fn(() => disposable()),
    registerDefinitionProvider: vi.fn(() => disposable()),
    registerSignatureHelpProvider: vi.fn(() => disposable()),
    registerDocumentSymbolProvider: vi.fn(() => disposable()),
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
  return { monaco, model, languages, disposables };
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
  it("registers every provider for GLSL and Slang", () => {
    const { monaco, languages } = monacoFixture();
    new MonacoLanguageServiceManager(monaco as never, { glsl: async () => serviceFixture(), slang: async () => serviceFixture() });
    for (const method of ["registerCompletionItemProvider", "registerHoverProvider", "registerDefinitionProvider", "registerSignatureHelpProvider", "registerDocumentSymbolProvider", "registerColorProvider"] as const) {
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
