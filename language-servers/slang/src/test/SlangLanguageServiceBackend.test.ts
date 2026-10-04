import { describe, expect, it, vi } from "vitest";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { SlangLanguageServiceBackend } from "../SlangLanguageServiceBackend.js";
import type { SlangLanguageServer, SlangLanguageServerModule } from "../slangLanguageServerTypes.js";
import type { SlangList } from "../slangLanguageServerTypes.js";

const uri = "file:///image.slang";
const document = { uri, languageId: "slang" as const, version: 1, environmentGeneration: 1 };
const environment: ShaderAuthoringEnvironment = {
  documentUri: uri,
  languageId: "slang",
  generation: 1,
  passName: "Image",
  stage: "fragment",
  customUniforms: [],
  resources: [],
  virtualFiles: [],
};

function fixture() {
  const server = {
    didOpenTextDocument: vi.fn<SlangLanguageServer["didOpenTextDocument"]>(),
    didCloseTextDocument: vi.fn<SlangLanguageServer["didCloseTextDocument"]>(),
    didChangeTextDocument: vi.fn<SlangLanguageServer["didChangeTextDocument"]>(),
    completion: vi.fn<SlangLanguageServer["completion"]>(),
    hover: vi.fn<SlangLanguageServer["hover"]>(),
    gotoDefinition: vi.fn<SlangLanguageServer["gotoDefinition"]>(),
    signatureHelp: vi.fn<SlangLanguageServer["signatureHelp"]>(),
    documentSymbol: vi.fn<SlangLanguageServer["documentSymbol"]>(),
    getDiagnostics: vi.fn<SlangLanguageServer["getDiagnostics"]>(),
    delete: vi.fn(),
  };
  const module = { createLanguageServer: vi.fn(() => server) } as unknown as SlangLanguageServerModule;
  return { module, server };
}

function list<T>(items: readonly T[]): SlangList<T> {
  return { size: () => items.length, get: index => items[index] };
}

describe("SlangLanguageServiceBackend", () => {
  it("rejects an unavailable language server before accepting documents", () => {
    const module = { createLanguageServer: () => null } as SlangLanguageServerModule;

    expect(() => new SlangLanguageServiceBackend(module)).toThrow("createLanguageServer returned null");
  });

  it("reopens authored text after context changes and releases every opened server document", async () => {
    const { module, server } = fixture();
    const backend = new SlangLanguageServiceBackend(module);
    const sharedUri = "file:///shared.slang";
    const virtualUri = "file:///helpers.slang";
    const withContext = {
      ...environment,
      commonFile: { uri: sharedUri, text: "float shared;", version: 1, stage: "fragment" as const },
      virtualFiles: [{ uri: virtualUri, text: "float helper;", version: 1 }],
    };

    await backend.syncEnvironment({ ...withContext, generation: 2 });
    await backend.openDocument({ uri, languageId: "slang", version: 1, text: "float value;" });
    expect(server.didOpenTextDocument).toHaveBeenCalledWith(sharedUri, "float shared;");
    expect(server.didOpenTextDocument).toHaveBeenCalledWith(virtualUri, "float helper;");
    expect(server.didOpenTextDocument.mock.calls.at(-1)?.[0]).toBe(uri);

    // Hosts may refresh unchanged context while an editor is open. The prior
    // generated documents must be closed before their new snapshots open.
    await backend.syncEnvironment({ ...withContext, generation: 3 });
    expect(server.didCloseTextDocument).toHaveBeenCalledWith(sharedUri);
    expect(server.didCloseTextDocument).toHaveBeenCalledWith(virtualUri);

    await backend.changeDocument({ uri, languageId: "slang", version: 2, text: "float changed;" });
    expect(server.didCloseTextDocument).toHaveBeenCalledWith(uri);
    expect(server.didOpenTextDocument.mock.calls.at(-1)?.[1]).toContain("float changed;");

    await backend.closeDocument(uri);
    await backend.closeDocument(uri);
    await backend.dispose();
    expect(server.didCloseTextDocument).toHaveBeenCalledWith(sharedUri);
    expect(server.didCloseTextDocument).toHaveBeenCalledWith(virtualUri);
    expect(server.delete).toHaveBeenCalledOnce();
  });

  it("does not expose stale state or send server events for another language", async () => {
    const { module, server } = fixture();
    const backend = new SlangLanguageServiceBackend(module);

    await backend.syncEnvironment({ ...environment, languageId: "wgsl" });
    await backend.openDocument({ uri, languageId: "wgsl", version: 1, text: "fn main() {}" });

    expect(backend.current({ document })).toBeUndefined();
    expect(await backend.documentColors({ document })).toEqual([]);
    expect(server.didOpenTextDocument).not.toHaveBeenCalled();
  });

  it("does not retain a compiler session when the module has no WGSL target", () => {
    const { module } = fixture();
    const release = vi.fn();
    module.createGlobalSession = () => ({ createSession: vi.fn(), delete: release });
    module.getCompileTargets = () => [{ name: "spirv", value: 7 }];
    const backend = new SlangLanguageServiceBackend(module);

    expect(backend.compiler()).toBeUndefined();
    expect(backend.compiler()).toBeUndefined();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("caches a usable compiler target and releases it on disposal", async () => {
    const { module } = fixture();
    const release = vi.fn();
    const globalRelease = vi.fn();
    const session = { loadModuleFromSource: vi.fn(() => ({ delete: release })), delete: release };
    module.createGlobalSession = () => ({ createSession: vi.fn(() => session), delete: globalRelease });
    module.getCompileTargets = () => [{ name: "wgsl", value: 3 }];
    const backend = new SlangLanguageServiceBackend(module);

    expect(backend.compiler()).toEqual(expect.objectContaining({ target: 3 }));
    expect(backend.compiler()).toEqual(expect.objectContaining({ target: 3 }));
    await backend.dispose();
    expect(globalRelease).toHaveBeenCalledOnce();
  });

  it("uses native declaration identity to rename syntax outside the fallback parser", async () => {
    const { module, server } = fixture();
    server.gotoDefinition.mockReturnValue(list([{ uri, range: { start: { line: 0, character: 7 }, end: { line: 0, character: 12 } } }]));
    const backend = new SlangLanguageServiceBackend(module);
    const text = "float value;\nfloat use = value;";
    await backend.syncEnvironment(environment);
    await backend.openDocument({ uri, languageId: "slang", version: 1, text });

    expect(backend.nativeRename([{ uri, text, environment }], { document, position: { line: 0, character: 8 }, newName: "renamed" })).toEqual({
      changes: { [uri]: expect.arrayContaining([expect.objectContaining({ newText: "renamed" })]) },
    });
    expect(backend.nativeRename([{ uri, text, environment }], { document, position: { line: 0, character: 8 }, newName: "not valid" })).toBeNull();
  });
});
