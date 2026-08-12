import { describe, expect, it, vi } from "vitest";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { SlangLanguageService } from "../SlangLanguageService";
import type { SlangLanguageServerModule, SlangList } from "../slangLanguageServerTypes";

function list<T>(items: T[]): SlangList<T> {
  return { size: () => items.length, get: (index) => items[index], delete: vi.fn() };
}

function fixture() {
  const server = {
    didOpenTextDocument: vi.fn(),
    didCloseTextDocument: vi.fn(),
    didChangeTextDocument: vi.fn(),
    completion: vi.fn(() => list([{ label: "normalize", kind: 3, detail: "float3 normalize(float3)", data: "" }])),
    hover: vi.fn(() => ({ contents: { kind: "markdown", value: "normalizes a vector" }, range: { start: { line: 3, character: 0 }, end: { line: 3, character: 9 } } })),
    gotoDefinition: vi.fn(() => list([{ uri: "file:///image.slang", range: { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } } }])),
    signatureHelp: vi.fn(() => undefined),
    documentSymbol: vi.fn(() => list([{ name: "mainImage", detail: "", kind: 12, range: { start: { line: 100, character: 0 }, end: { line: 100, character: 10 } }, selectionRange: { start: { line: 100, character: 0 }, end: { line: 100, character: 9 } }, children: list([]) }])),
    getDiagnostics: vi.fn(() => list([])),
    delete: vi.fn(),
  };
  const module = { createLanguageServer: vi.fn(() => server) } as unknown as SlangLanguageServerModule;
  return { module, server };
}

const uri = "file:///image.slang";
const environment: ShaderAuthoringEnvironment = {
  documentUri: uri,
  languageId: "slang",
  generation: 1,
  passName: "Image",
  stage: "fragment",
  customUniforms: [{ name: "tint", type: "vec3" }],
  resources: [],
  virtualFiles: [],
};
const revision = { uri, languageId: "slang" as const, version: 1, environmentGeneration: 1 };

describe("SlangLanguageService", () => {
  it("loads generated Shader Studio declarations before user source", async () => {
    const { module, server } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "float4 mainImage(float2 p) { return float4(tint, 1); }" });
    expect(server.didOpenTextDocument).toHaveBeenCalledWith(uri, expect.stringContaining("float3 tint;"));
    expect(server.didOpenTextDocument.mock.calls[0]?.[1]).toContain("float4 mainImage");
  });

  it("opens virtual import files before the user document", async () => {
    const { module, server } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({
      ...environment,
      virtualFiles: [{ uri: "file:///common.slang", version: 1, text: "module common; public float twice(float x) { return x * 2.0; }" }],
    });
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "import common;" });
    expect(server.didOpenTextDocument.mock.calls.map((call) => call[0])).toEqual(["file:///common.slang", uri]);
  });

  it("converts results, offsets positions, and releases vectors", async () => {
    const { module, server } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "normalize(float3(1));" });
    const result = await service.completion({ document: revision, position: { line: 0, character: 2 } });
    expect(result[0]?.label).toBe("normalize");
    expect(server.completion.mock.calls[0]?.[1].line).toBeGreaterThan(0);
    expect(server.completion.mock.results[0]?.value.delete).toHaveBeenCalledOnce();
    expect((await service.documentSymbols({ document: revision }))[0]?.range.start.line).toBeLessThan(100);
  });

  it("provides Shader Studio docs and Slang literal colors", async () => {
    const { module } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "float4 c = float4(1.0, 0.5, 0.0, 1.0); iResolution;" });
    expect(await service.documentColors({ document: revision })).toHaveLength(1);
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 50 } }))?.contents))
      .toContain("Canvas dimensions");
  });

  it("falls back to local symbols, definitions, and signatures when the WASM server returns none", async () => {
    const { module, server } = fixture();
    server.gotoDefinition.mockReturnValue(list([]));
    server.documentSymbol.mockReturnValue(list([]));
    server.signatureHelp.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = "float twice(float value) { return value * 2.0; }\nfloat result = twice(1.0);";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });
    expect((await service.documentSymbols({ document: revision })).map((item) => item.name)).toContain("twice");
    expect(await service.definition({ document: revision, position: { line: 1, character: 17 } })).toHaveLength(1);
    expect((await service.signatureHelp({ document: revision, position: { line: 1, character: 24 } }))?.signatures[0]?.label).toContain("twice");
  });
});
