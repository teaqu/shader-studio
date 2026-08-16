import { describe, expect, it, vi } from "vitest";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { SlangLanguageService } from "../SlangLanguageService";
import { SLANG_INTRINSICS } from "../intrinsics";
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
  it("documents the mainImage contract with a renamed coordinate parameter", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([
      { label: "mainImage", kind: 3, detail: "float4 mainImage(float2)", data: "" },
    ]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = "float4 mainImage(float2 pixelPosition) { return float4(pixelPosition, 0.0, 1.0); }";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 10 } }))?.contents))
      .toContain("float4 mainImage(float2 pixelPosition)");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 10 } }))?.contents))
      .toContain("fragment entry point");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 10 } }))?.contents))
      .toContain("Defined in image.slang(1)");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 30 } }))?.contents))
      .toContain("lower-left");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 62 } }))?.contents))
      .toContain("Pixel-space");
    const completions = await service.completion({ document: revision, position: { line: 0, character: 62 } });
    expect(completions.find((item) => item.label === "mainImage")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("fragment entry point") }));
    expect(completions.find((item) => item.label === "pixelPosition")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("lower-left") }));
  });

  it("does not offer the mainImage coordinate parameter outside its function body", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = "float4 mainImage(float2 pixelPosition) { return float4(pixelPosition, 0.0, 1.0); }\nfloat helper() { return 1.0; }";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const completions = await service.completion({ document: revision, position: { line: 1, character: 25 } });
    expect(completions.map((item) => item.label)).not.toContain("pixelPosition");
  });

  it("uses concise intrinsic descriptions without return-value boilerplate", () => {
    expect(SLANG_INTRINSICS.filter((item) => /^returns?\b/i.test(item.description))).toEqual([]);
  });

  it("fills empty official completion fields with Shader Studio intrinsic docs", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([{
      label: "fmod",
      kind: 3,
      detail: "",
      documentation: { kind: "markdown", value: "" },
      data: "",
    }]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "float value = fmod(2.0, 1.5);" });

    const completion = (await service.completion({ document: revision, position: { line: 0, character: 15 } }))
      .find((item) => item.label === "fmod");
    expect(completion?.detail).toContain("fmod");
    expect(JSON.stringify(completion?.documentation)).toContain("remainder");
  });

  it("documents integer exponent parameters with their compiler types", () => {
    expect(SLANG_INTRINSICS.find((item) => item.name === "frexp")?.signatures)
      .toContain("T frexp(T value, out int exponent)");
    expect(SLANG_INTRINSICS.find((item) => item.name === "ldexp")?.signatures)
      .toContain("T ldexp(T value, int exponent)");
  });

  it("documents compute attributes and system-value semantics", async () => {
    const { module, server } = fixture();
    server.hover.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({ ...environment, stage: "compute", outputLayers: 2 });
    const text = `[shader("compute")]
[numthreads(1, 1, 1)]
void computeMain(
    uint3 dispatchId : SV_DispatchThreadID,
    uint3 groupId : SV_GroupID,
    uint3 localId : SV_GroupThreadID,
    uint groupIndex : SV_GroupIndex) {
    int repeatIndex = iDispatch;
    writeOutput(dispatchId.xy, 0u, float4(1.0));
}`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const completions = await service.completion({ document: revision, position: { line: 1, character: 5 } });
    expect(completions.map((item) => item.label)).toEqual(expect.arrayContaining([
      "shader", "numthreads", "SV_DispatchThreadID", "SV_GroupID", "SV_GroupThreadID", "SV_GroupIndex", "iDispatch", "writeOutput",
    ]));
    expect(completions.find((item) => item.label === "writeOutput")?.detail)
      .toBe("void writeOutput(uint2 coord, uint layer, float4 color)");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 1, character: 5 } }))?.contents))
      .toContain("workgroup");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 3, character: 28 } }))?.contents))
      .toContain("Global dispatch");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 7, character: 26 } }))?.contents))
      .toContain("repetition index");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 8, character: 8 } }))?.contents))
      .toContain("one layer");
  });

  it("does not provide fallback hovers for words inside comments", async () => {
    const { module, server } = fixture();
    server.hover.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({ ...environment, stage: "compute" });
    const text = `// numthreads fmod iResolution
/* numthreads */
[numthreads(1, 1, 1)]
void computeMain() {}`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    expect(await service.hover({ document: revision, position: { line: 0, character: 5 } })).toBeNull();
    expect(await service.hover({ document: revision, position: { line: 0, character: 16 } })).toBeNull();
    expect(await service.hover({ document: revision, position: { line: 0, character: 21 } })).toBeNull();
    expect(await service.hover({ document: revision, position: { line: 1, character: 5 } })).toBeNull();
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 2, character: 5 } }))?.contents))
      .toContain("workgroup");
  });

  it("documents the Shader Studio vertex hook and its mutable parameters", async () => {
    const { module, server } = fixture();
    server.hover.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({ ...environment, stage: "vertex" });
    const text = "void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position += normal; }";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const completions = await service.completion({ document: revision, position: { line: 0, character: 5 } });
    expect(completions.filter((item) => item.label === "mainVertex")).toHaveLength(1);
    expect(completions.filter((item) => item.label === "position")).toHaveLength(1);
    expect(completions.find((item) => item.label === "mainVertex")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("vertex hook") }));
    expect(completions.find((item) => item.label === "position")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("position") }));
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 7 } }))?.contents))
      .toContain("vertex hook");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 31 } }))?.contents))
      .toContain("object-space");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 74 } }))?.contents))
      .toContain("texture coordinate");
  });

  it("documents and completes renamed Slang vertex-hook parameters by role", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    server.hover.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({ ...environment, stage: "vertex" });
    const text = "void mainVertex(inout float3 deformed, inout float3 surfaceNormal, inout float2 textureUv) { deformed += surfaceNormal * textureUv.x; }";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const hoverAt = (name: string, occurrence = 0) => {
      let offset = -1;
      for (let index = 0; index <= occurrence; index++) {
        offset = text.indexOf(name, offset + 1);
      }
      return service.hover({ document: revision, position: { line: 0, character: offset + 1 } });
    };
    expect(JSON.stringify((await hoverAt("deformed"))?.contents))
      .toContain("vertex position");
    expect(JSON.stringify((await hoverAt("surfaceNormal"))?.contents))
      .toContain("vertex normal");
    expect(JSON.stringify((await hoverAt("textureUv"))?.contents))
      .toContain("texture coordinate");
    expect(JSON.stringify((await hoverAt("deformed", 1))?.contents))
      .toContain("vertex position");
    const completions = await service.completion({ document: revision, position: { line: 0, character: text.length - 3 } });
    expect(completions.find((item) => item.label === "mainVertex")?.detail)
      .toBe("void mainVertex(inout float3 deformed, inout float3 surfaceNormal, inout float2 textureUv)");
    expect(completions.find((item) => item.label === "deformed")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("vertex position") }));
    expect(completions.find((item) => item.label === "surfaceNormal")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("vertex normal") }));
    expect(completions.find((item) => item.label === "textureUv")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("texture coordinate") }));
  });

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
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({
      ...environment,
      virtualFiles: [{ uri: "file:///common.slang", version: 1, text: "module common; public float twice(float x) { return x * 2.0; }" }],
    });
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "import common;" });
    expect(server.didOpenTextDocument.mock.calls.map((call) => call[0])).toEqual(["file:///common.slang", uri]);
    expect((await service.completion({ document: revision, position: { line: 0, character: 13 } })).map((item) => item.label))
      .toContain("twice");
  });

  it("navigates imported symbols when the official server points back into the caller", async () => {
    const { module, server } = fixture();
    server.gotoDefinition.mockReturnValue(list([{
      uri,
      range: { start: { line: 100, character: 7 }, end: { line: 100, character: 12 } },
    }]));
    server.documentSymbol.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({
      ...environment,
      virtualFiles: [{ uri: "file:///common.slang", version: 1, text: "module common;\npublic float twice(float x) { return x * 2.0; }" }],
    });
    const text = "import common;\nfloat4 mainImage(float2 p) { return float4(twice(1.0)); }";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const definitions = await service.definition({ document: revision, position: { line: 1, character: 44 } });
    expect(definitions[0]?.uri).toBe("file:///common.slang");
    expect(definitions[0]?.range.start.line).toBe(1);
    expect((await service.documentSymbols({ document: revision })).map((item) => item.name)).not.toContain("twice");
  });

  it("offsets positions, releases vectors, and filters generated symbol ranges", async () => {
    const { module, server } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "normalize(float3(1));" });
    const result = await service.completion({ document: revision, position: { line: 0, character: 2 } });
    expect(result[0]?.label).toBe("normalize");
    expect(result.filter((item) => item.label === "normalize")).toHaveLength(1);
    expect(result.map((item) => item.label)).not.toContain("mainVertex");
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
      .toContain("Floating-point remainder");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 1, character: 20 } }))?.contents))
      .toContain("input channel 0");
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 2, character: 20 } }))?.contents))
      .toContain("noise");
    expect((await service.signatureHelp({ document: revision, position: { line: 1, character: 38 } }))?.signatures[0]?.label)
      .toBe("float4 sampleIChannel0(float2 uv)");
    const completions = await service.completion({ document: revision, position: { line: 2, character: 20 } });
    expect(JSON.stringify(completions.find((item) => item.label === "sampleNoise")?.documentation)).toContain("input channel 0");
  });

  it("documents generally useful math, bit, conversion, and packing helpers", async () => {
    const { module, server } = fixture();
    server.hover.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "float x = copysign(1.0, -1.0);" });

    const completions = await service.completion({ document: revision, position: { line: 0, character: 12 } });
    const expected = [
      "bit_cast", "bitfieldExtract", "bitfieldInsert", "copysign", "cospi", "f16tof32", "f32tof16",
      "fdim", "fract", "nextafter", "packHalf2x16", "packSnorm2x16", "packSnorm4x8", "packUnorm2x16",
      "packUnorm4x8", "powr", "rint", "select", "sinpi", "tanpi", "unpackHalf2x16ToFloat",
      "unpackSnorm2x16ToFloat", "unpackSnorm4x8ToFloat", "unpackUnorm2x16ToFloat", "unpackUnorm4x8ToFloat",
    ];
    for (const name of expected) {
      const item = completions.find((completion) => completion.label === name);
      expect(item, name).toBeDefined();
      expect(JSON.stringify(item?.documentation), name).not.toBe("");
    }
    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 15 } }))?.contents))
      .toContain("magnitude");
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

  it("replaces generated module hashes in local function hovers with the source filename and line", async () => {
    const { module, server } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = `${"\n".repeat(11)}uint gosperGliderGun(uint2 cell) { return cell.x; }`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });
    server.hover.mockReturnValue({
      contents: {
        kind: "markdown",
        value: "func gosperGliderGun(uint2 cell) -> uint\nDefined in 20bb898b269d06c72678cfc208b07589bca28d9f(79)",
      },
      range: { start: { line: 12, character: 5 }, end: { line: 12, character: 22 } },
    });

    const hover = await service.hover({ document: revision, position: { line: 11, character: 8 } });
    const contents = JSON.stringify(hover?.contents);
    expect(contents).toContain("Defined in image.slang(12)");
    expect(contents).not.toContain("20bb898b269d06c72678cfc208b07589bca28d9f");
  });

  it("replaces generated module hashes in local parameter hovers", async () => {
    const { module, server } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = "float exercise(float input) { return input; }";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });
    const openedSource = server.didOpenTextDocument.mock.calls.at(-1)?.[1] as string;
    const offset = openedSource.slice(0, openedSource.lastIndexOf(text)).split("\n").length - 1;
    server.hover.mockReturnValue({
      contents: {
        kind: "markdown",
        value: `(parameter) float input\nDefined in 163822878836dd49609d813a83756631d58ad921(${offset + 1})`,
      },
      range: { start: { line: offset, character: 21 }, end: { line: offset, character: 26 } },
    });
    server.gotoDefinition.mockReturnValue(list([{
      uri,
      range: { start: { line: offset, character: 21 }, end: { line: offset, character: 26 } },
    }]));

    const hover = await service.hover({ document: revision, position: { line: 0, character: 23 } });
    const contents = JSON.stringify(hover?.contents);
    expect(contents).toContain("Defined in image.slang(1)");
    expect(contents).not.toContain("163822878836dd49609d813a83756631d58ad921");
  });
});
