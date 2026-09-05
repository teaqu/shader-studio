import { describe, expect, it, vi } from "vitest";
import { CompletionItemKind } from "vscode-languageserver-protocol";
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

  it("does not offer completions inside line or block comments", async () => {
    const { module, server } = fixture();
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = `// inputs
/* inputs */
float value = inputs;`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    await expect(service.completion({ document: revision, position: { line: 0, character: 5 } })).resolves.toEqual([]);
    await expect(service.completion({ document: revision, position: { line: 1, character: 5 } })).resolves.toEqual([]);
    expect(server.completion).not.toHaveBeenCalled();

    await expect(service.completion({ document: revision, position: { line: 2, character: 16 } }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ label: "inputs" })]));
  });

  it("keeps official member completions without adding global symbols", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([{
      label: "Sample",
      kind: 3,
      detail: "float4 Texture2D.Sample(SamplerState sampler, float2 location)",
      data: "",
    }]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = "float4 color = inputs.noise.texture.sam;";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const completions = await service.completion({
      document: revision,
      position: { line: 0, character: text.indexOf("sam") + 3 },
    });
    expect(completions.map((item) => item.label)).toEqual(["Sample"]);
  });

  it("completes the generated inputs object and its typed input members", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({
      ...environment,
      resources: [
        { name: "iChannel0", kind: "texture-2d", slot: 0 },
        { name: "sky", kind: "texture-cube", slot: 1 },
        { name: "albedo", kind: "texture-2d", slot: 2 },
        { name: "volume", kind: "texture-3d", slot: 3 },
        { name: "particles", kind: "storage", elementType: "float4" },
        { name: "late", kind: "texture-2d", slot: 4 },
        { name: "later", kind: "texture-2d", slot: 5 },
      ],
    });
    const text = `float4 mainImage(float2 p)
{
    inputs.
    inputs.iChannel0.
    inputs.iChannel0.texture.
    return float4(0.0);
}`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });
    const labels = async (line: number) => (await service.completion({
      document: revision,
      position: { line, character: (text.split("\n")[line] ?? "").length },
    })).map((item) => item.label);

    const globals = await labels(1);
    expect(globals).toContain("inputs");
    expect((await service.completion({ document: revision, position: { line: 1, character: 4 } }))
      .find((item) => item.label === "inputs")?.documentation)
      .toEqual(expect.objectContaining({ value: expect.stringContaining("Configured shader inputs") }));
    expect(JSON.stringify((await service.hover({
      document: revision,
      position: { line: 3, character: "    inputs.iCh".length },
    }))?.contents)).toContain("Configured input channel");
    expect(globals).not.toEqual(expect.arrayContaining([
      "iChannel0", "iChannel0Sampler", "sampleIChannel0", "sampleSky", "iCh0", "sky",
    ]));
    expect(await labels(2)).toEqual(expect.arrayContaining(["iChannel0", "sky", "albedo", "volume"]));
    expect(await labels(3)).toEqual(expect.arrayContaining(["texture", "sampler", "size", "time", "loaded", "Sample", "SampleLevel", "SampleGrad"]));
    const inputMethods = await service.completion({ document: revision, position: { line: 3, character: "    inputs.iChannel0.".length } });
    expect(inputMethods.filter((item) => item.label === "Sample").map((item) => item.detail)).toEqual(expect.arrayContaining([
      "float4 ShaderStudioChannel2D.Sample(float2 uv)",
      "float4 ShaderStudioChannel2D.Sample(SamplerState sampling, float2 uv)",
    ]));
    server.signatureHelp.mockReturnValue(undefined);
    const methodSource = "float4 mainImage(float2 uv) { return inputs.iChannel0.Sample(inputs.iChannel0.sampler, uv); }";
    await service.changeDocument({ uri, languageId: "slang", version: 2, text: methodSource });
    const signatures = await service.signatureHelp({
      document: { ...revision, version: 2 },
      position: { line: 0, character: methodSource.indexOf(", uv") + 4 },
    });
    expect(signatures?.signatures.map((signature) => signature.label)).toContain(
      "float4 ShaderStudioChannel2D.Sample(SamplerState sampling, float2 uv)",
    );
    const twoCalls = "float4 mainImage(float2 uv) { return inputs.iChannel0.Sample (uv) + inputs.sky.Sample(float3(uv, 1.0)); }";
    await service.changeDocument({ uri, languageId: "slang", version: 3, text: twoCalls });
    const firstCall = await service.signatureHelp({
      document: { ...revision, version: 3 },
      position: { line: 0, character: twoCalls.indexOf("uv) +") + 2 },
    });
    expect(firstCall?.signatures.map((signature) => signature.label)).toContain(
      "float4 ShaderStudioChannel2D.Sample(float2 uv)",
    );
  });

  it("offers an empty inputs object when no inputs are configured", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    for (const stage of ["fragment", "compute"] as const) {
      await service.syncEnvironment({ ...environment, stage, resources: [] });
      await service.openDocument({ uri, languageId: "slang", version: 1, text: "void main() {}" });
      const labels = (await service.completion({ document: revision, position: { line: 0, character: 0 } })).map((item) => item.label);
      expect(labels).toContain("inputs");
    }
  });

  it("offers channel members in compute shaders", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({
      ...environment,
      stage: "compute",
      resources: [{ name: "iChannel0", kind: "texture-cube", slot: 0 }],
    });
    const text = "[shader(\"compute\")]\nvoid computeMain() { inputs.iChannel0.texture. }";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const globals = await service.completion({ document: revision, position: { line: 0, character: 0 } });
    expect(globals.map((item) => item.label)).toContain("inputs");
    const members = await service.completion({ document: revision, position: { line: 1, character: text.split("\n")[1]!.indexOf(". }") + 1 } });
    expect(members.map((item) => item.label)).toEqual(expect.arrayContaining(["Sample", "SampleLevel", "SampleGrad"]));
  });

  it("completes vector components instead of every symbol after a member selector", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = `float4 mainImage(float2 p)
{
    float2 uv = p;
    uv.
    return float4(uv, 0.0, 1.0);
}`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const items = await service.completion({ document: revision, position: { line: 3, character: 7 } });

    expect(items.map((item) => item.label)).toEqual(["x", "y", "xy", "r", "g", "rg", "s", "t", "st"]);
    expect(items).toContainEqual(expect.objectContaining({ label: "x", detail: "float", kind: CompletionItemKind.Field }));
    expect(items).toContainEqual(expect.objectContaining({ label: "xy", detail: "float2" }));
  });

  it("completes struct fields declared in the document, including generic vector members", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = `struct Material { float3 albedo; float rough; };
float4 mainImage(float2 p)
{
    Material m;
    m.
    vector<half, 3> tinted;
    tinted.
    return float4(m.albedo, 1.0);
}`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    const fields = await service.completion({ document: revision, position: { line: 4, character: 6 } });
    expect(fields).toEqual([
      expect.objectContaining({ label: "albedo", detail: "float3", kind: CompletionItemKind.Field }),
      expect.objectContaining({ label: "rough", detail: "float" }),
    ]);

    const generic = await service.completion({ document: revision, position: { line: 6, character: 11 } });
    expect(generic.map((item) => item.label)).toContain("xyz");
  });

  it("completes members of built-in uniforms and custom uniforms", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = `float4 mainImage(float2 p)
{
    float2 uv = p / iResolution.
    float3 shade = tint.
    return float4(uv, 0.0, 1.0);
}`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });
    const labels = async (line: number) => (await service.completion({
      document: revision,
      position: { line, character: (text.split("\n")[line] ?? "").length },
    })).map((item) => item.label);

    expect(await labels(2)).toContain("xyz");
    expect(await labels(3)).toContain("rgb");
  });

  it("offers no suggestions when the selected expression has no members", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = `float4 mainImage(float2 p)
{
    float2 uv = p;
    float t = uv.x;
    missing.
    t.
    return float4(uv, t, 1.0);
}`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text });
    const completions = async (line: number) => service.completion({
      document: revision,
      position: { line, character: (text.split("\n")[line] ?? "").length },
    });

    expect(await completions(4)).toEqual([]);
    expect(await completions(5)).toEqual([]);
  });

  it("does not show signature help inside comments", async () => {
    const { module, server } = fixture();
    server.signatureHelp.mockReturnValue({
      signatures: list([{ label: "float3 normalize(float3 value)", documentation: { kind: "markdown", value: "" }, parameters: list([]) }]),
      activeSignature: 0,
      activeParameter: 0,
    });
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = "// normalize(\n/* normalize( */";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    await expect(service.signatureHelp({ document: revision, position: { line: 0, character: 12 } })).resolves.toBeNull();
    await expect(service.signatureHelp({ document: revision, position: { line: 1, character: 12 } })).resolves.toBeNull();
    expect(server.signatureHelp).not.toHaveBeenCalled();
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
    const completions = await service.completion({ document: revision, position: { line: 0, character: text.length } });
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

  it("provides completion, hover, signatures, and navigation for implicit Shader Studio Common", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    server.hover.mockReturnValue(undefined);
    server.gotoDefinition.mockReturnValue(list([]));
    server.signatureHelp.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({
      ...environment,
      passName: "BufferA",
      commonFile: {
        uri: "file:///workspace/common.slang",
        version: 1,
        text: "float sharedTone(float value) { return value * 0.5; }",
      },
    });
    const text = "float4 mainImage(float2 coord) { return float4(sharedTone(coord.x)); }";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });
    const position = { line: 0, character: text.indexOf("sharedTone") + 3 };

    expect((await service.completion({ document: revision, position })).map((item) => item.label)).toContain("sharedTone");
    expect(JSON.stringify((await service.hover({ document: revision, position }))?.contents)).toContain("Shader Studio Common");
    expect((await service.definition({ document: revision, position }))[0]?.uri).toBe("file:///workspace/common.slang");
    expect((await service.signatureHelp({
      document: revision,
      position: { line: 0, character: text.indexOf("coord.x") + "coord.x".length },
    }))?.signatures.map((item) => item.label)).toContain("float sharedTone(float value)");
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

  it("documents broader Slang intrinsics without reintroducing channel helper functions", async () => {
    const { module, server } = fixture();
    server.hover.mockReturnValue(undefined);
    server.signatureHelp.mockReturnValue(undefined);
    const service = new SlangLanguageService(module);
    await service.syncEnvironment(environment);
    const text = "float x = fmod(3.0, 2.0);";
    await service.openDocument({ uri, languageId: "slang", version: 1, text });

    expect(JSON.stringify((await service.hover({ document: revision, position: { line: 0, character: 12 } }))?.contents))
      .toContain("Floating-point remainder");
    const completions = await service.completion({ document: revision, position: { line: 0, character: text.length } });
    expect(completions.map((item) => item.label)).not.toEqual(expect.arrayContaining([
      "sampleIChannel0", "sampleIChannel0Lod", "sampleIChannel0Grad", "sampleNoise",
    ]));
  });

  it("does not fabricate sampling helpers for configured channels", async () => {
    const { module, server } = fixture();
    server.completion.mockReturnValue(list([]));
    const service = new SlangLanguageService(module);
    await service.syncEnvironment({
      ...environment,
      resources: [
        { name: "noise", kind: "texture-2d", slot: 0 },
        { name: "sky", kind: "texture-cube", slot: 1 },
      ],
    });
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "float4 c = float4(0.0);" });

    const completions = await service.completion({ document: revision, position: { line: 0, character: 11 } });
    expect(completions.map((item) => item.label)).not.toEqual(expect.arrayContaining([
      "sampleIChannel0", "sampleIChannel0Lod", "sampleIChannel0Grad", "sampleNoise", "sampleSky",
    ]));
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
