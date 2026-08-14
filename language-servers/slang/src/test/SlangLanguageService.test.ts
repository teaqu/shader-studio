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
    completion: vi.fn(() => list([{
      label: "normalize",
      kind: 3,
      detail: "float3 normalize(float3)",
      data: "",
      textEdit: { range: { start: { line: 3, character: 0 }, end: { line: 3, character: 9 } }, text: "normalize" },
    }])),
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

  it("offsets positions, releases vectors, and filters generated symbol ranges", async () => {
    const { module, server } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "normalize(float3(1));" });
    const result = await service.completion({ document: revision, position: { line: 0, character: 2 } });
    expect(result[0]?.label).toBe("normalize");
    expect(result.filter((item) => item.label === "normalize")).toHaveLength(1);
    expect(JSON.stringify(result.find((item) => item.label === "normalize")?.documentation)).toContain("unit length");
    expect(server.completion.mock.calls[0]?.[1].line).toBeGreaterThan(0);
    expect(server.completion.mock.results[0]?.value.delete).toHaveBeenCalledOnce();
    expect(await service.documentSymbols({ document: revision })).toEqual([]);
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

  it("provides documentation and signatures for common Slang functions", async () => {
    const { module, server } = fixture();
    server.hover.mockReturnValue(undefined);
    server.signatureHelp.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "float3 n = normalize(float3(1));" });

    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 14 } }))?.contents))
      .toContain("unit length");
    expect((await service.signatureHelp({ document: revision, position: { line: 0, character: 30 } }))?.signatures[0]?.label)
      .toContain("normalize");
  });

  it("documents broader Slang intrinsics and generated channel sampling helpers", async () => {
    const { module, server } = fixture();
    server.hover.mockReturnValue(undefined);
    server.signatureHelp.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({
      ...environment,
      resources: [{ name: "noise", kind: "texture-2d" }],
    });
    const text = "float x = fmod(3.0, 2.0);\nfloat4 c = sampleIChannel0(float2(0.5));\nfloat4 d = sampleNoise(float2(0.5));";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 12 } }))?.contents))
      .toContain("floating-point remainder");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 1, character: 20 } }))?.contents))
      .toContain("input channel 0");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 2, character: 20 } }))?.contents))
      .toContain("noise");
    expect((await service.signatureHelp({ document: revision, position: { line: 1, character: 38 } }))?.signatures[0]?.label)
      .toBe("float4 sampleIChannel0(float2 uv)");
    const completions = await service.completion({ document: revision, position: { line: 2, character: 20 } });
    expect(JSON.stringify(completions.find((item) => item.label === "sampleNoise")?.documentation)).toContain("input channel 0");
  });

  it("drops official ranges that point into the generated prelude", async () => {
    const { module, server } = fixture();
    server.getDiagnostics.mockReturnValue(list([{
      code: "bad-range",
      range: { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } },
      severity: 1,
      message: "generated prelude diagnostic",
    }]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "normalize(float3(1));" });

    const completions = await service.completion({ document: revision, position: { line: 0, character: 2 } });
    expect(completions.find((item) => item.label === "normalize")?.textEdit).toBeUndefined();
    expect(await service.definition({ document: revision, position: { line: 0, character: 2 } })).toEqual([]);
    expect(await service.diagnostics({ document: revision })).toEqual([]);
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
