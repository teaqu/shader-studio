import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import createSlangModule from "../../../../ui/src/slang/slang-wasm.js";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { SlangLanguageService } from "../SlangLanguageService";

describe("SlangLanguageService with bundled WASM", () => {
  it("uses the official browser language server for completion and diagnostics", async () => {
    const wasmBinary = readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
    const module = await createSlangModule({ wasmBinary });
    const service = new SlangLanguageService(module);
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
    await service.syncEnvironment(environment);
    const validSource = `
float exerciseEasyIntrinsics(float x)
{
    float signedValue = copysign(x, -1.0);
    float mathValue = fract(x) + fdim(x, 0.5) + nextafter(x, 1.0)
        + powr(abs(x) + 0.1, 2.0) + rint(x) + sinpi(x) + cospi(x) + tanpi(x);
    uint inserted = bitfieldInsert(bit_cast<uint>(x), 3u, 1u, 2u);
    uint extracted = bitfieldExtract(inserted, 1u, 2u);
    float halfValue = f16tof32(f32tof16(x));
    float2 unpackedHalf = unpackHalf2x16ToFloat(packHalf2x16(float2(x)));
    float2 unpackedSnorm2 = unpackSnorm2x16ToFloat(packSnorm2x16(float2(x)));
    float4 unpackedSnorm4 = unpackSnorm4x8ToFloat(packSnorm4x8(float4(x)));
    float2 unpackedUnorm2 = unpackUnorm2x16ToFloat(packUnorm2x16(float2(x)));
    float4 unpackedUnorm4 = unpackUnorm4x8ToFloat(packUnorm4x8(float4(x)));
    return select(
        extracted != 0u,
        signedValue + mathValue + halfValue,
        unpackedHalf.x + unpackedSnorm2.x + unpackedSnorm4.x + unpackedUnorm2.x + unpackedUnorm4.x);
}

float4 mainImage(float2 p) { return float4(normalize(tint), exerciseEasyIntrinsics(p.x)); }
`;
    await service.openDocument({ uri, languageId: "slang", version: 1, text: validSource });
    const document = { uri, languageId: "slang" as const, version: 1, environmentGeneration: 1 };
    const completions = await service.completion({ document, position: { line: 20, character: 48 } });
    expect(completions.some((item) => item.label === "normalize")).toBe(true);
    const localHover = await service.hover({ document, position: { line: 1, character: 10 } });
    expect(JSON.stringify(localHover?.contents)).toContain("Defined in image.slang(2)");
    expect(JSON.stringify(localHover?.contents)).not.toMatch(/Defined in [0-9a-f]{32,64}\(/i);
    const parameterHover = await service.hover({ document, position: { line: 1, character: 35 } });
    expect(JSON.stringify(parameterHover?.contents)).toContain("Defined in image.slang(2)");
    expect(JSON.stringify(parameterHover?.contents)).not.toMatch(/Defined in [0-9a-f]{32,64}\(/i);
    expect(await service.diagnostics({ document })).toEqual([]);
    await service.changeDocument({ uri, languageId: "slang", version: 2, text: "float4 mainImage(float2 p) { return badName; }" });
    const invalidDocument = { ...document, version: 2 };
    const diagnostics = await service.diagnostics({ document: invalidDocument });
    expect(diagnostics[0]?.message).toContain("undefined identifier");
    expect(diagnostics[0]?.range.start).toEqual({ line: 0, character: 36 });
    await service.dispose();
  }, 20_000);

  it("resolves a relative include supplied as a virtual file", async () => {
    const wasmBinary = readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
    const module = await createSlangModule({ wasmBinary });
    const service = new SlangLanguageService(module);
    const uri = "file:///workspace/image.slang";
    const source = [
      '#include "include/tone-map.slang"',
      "float4 mainImage(float2 p) { return float4(toneMap(float3(p, 1.0)), 1.0); }",
    ].join("\n");
    const environment: ShaderAuthoringEnvironment = {
      documentUri: uri,
      languageId: "slang",
      generation: 1,
      passName: "Image",
      stage: "fragment",
      customUniforms: [],
      resources: [],
      virtualFiles: [{
        uri: "file:///workspace/include/tone-map.slang",
        version: 1,
        text: "float3 toneMap(float3 color) { return color / (1.0 + color); }",
      }],
    };
    try {
      await service.syncEnvironment(environment);
      await service.openDocument({ uri, languageId: "slang", version: 1, text: source });

      const diagnostics = await service.diagnostics({
        document: { uri, languageId: "slang", version: 1, environmentGeneration: 1 },
      });

      expect(diagnostics).toEqual([]);
    } finally {
      await service.dispose();
    }
  }, 20_000);

  it("resolves a dotted import whose file declares only its basename", async () => {
    const wasmBinary = readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
    const module = await createSlangModule({ wasmBinary });
    const service = new SlangLanguageService(module);
    const uri = "file:///workspace/foundation.slang";
    const source = [
      "import lib.palette;",
      "float4 mainImage(float2 p) { return float4(paletteColor(), 1.0); }",
    ].join("\n");
    const environment: ShaderAuthoringEnvironment = {
      documentUri: uri,
      languageId: "slang",
      generation: 1,
      passName: "Image",
      stage: "fragment",
      customUniforms: [],
      resources: [],
      virtualFiles: [{
        uri: "file:///workspace/lib/palette.slang",
        version: 1,
        text: "module palette;\npublic float3 paletteColor() { return float3(1.0, 0.5, 0.0); }",
      }],
    };
    try {
      await service.syncEnvironment(environment);
      await service.openDocument({ uri, languageId: "slang", version: 1, text: source });

      const diagnostics = await service.diagnostics({
        document: { uri, languageId: "slang", version: 1, environmentGeneration: 1 },
      });

      expect(diagnostics).toEqual([]);
    } finally {
      await service.dispose();
    }
  }, 20_000);

  it("recognizes the Shader Studio compute repetition index", async () => {
    const wasmBinary = readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
    const module = await createSlangModule({ wasmBinary });
    const service = new SlangLanguageService(module);
    const uri = "file:///workspace/substep.slang";
    const source = [
      '[shader("compute")]',
      "[numthreads(1, 1, 1)]",
      "void simulateSubstep(uint3 tid : SV_DispatchThreadID)",
      "{",
      "    bool readA = (iDispatch % 2) == 0;",
      "}",
    ].join("\n");
    const environment: ShaderAuthoringEnvironment = {
      documentUri: uri,
      languageId: "slang",
      generation: 1,
      passName: "ComputeSubsteps",
      stage: "compute",
      outputLayers: 1,
      customUniforms: [],
      resources: [],
      virtualFiles: [],
    };
    try {
      await service.syncEnvironment(environment);
      await service.openDocument({ uri, languageId: "slang", version: 1, text: source });

      const diagnostics = await service.diagnostics({
        document: { uri, languageId: "slang", version: 1, environmentGeneration: 1 },
      });

      expect(diagnostics).toEqual([]);
    } finally {
      await service.dispose();
    }
  }, 20_000);

  it("compiles a configured buffer against implicit Shader Studio Common", async () => {
    const wasmBinary = readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
    const module = await createSlangModule({ wasmBinary });
    const service = new SlangLanguageService(module);
    const uri = "file:///workspace/buffer-a.slang";
    const source = "float4 mainImage(float2 p) { return float4(sharedTone(p.x)); }";
    const environment: ShaderAuthoringEnvironment = {
      documentUri: uri,
      languageId: "slang",
      generation: 1,
      passName: "BufferA",
      stage: "fragment",
      customUniforms: [],
      resources: [],
      virtualFiles: [{
        uri: "file:///workspace/shared/lib/math.slang",
        version: 1,
        text: "float halfValue(float value) { return value * 0.5; }",
      }],
      commonFile: {
        uri: "file:///workspace/shared/common.slang",
        version: 1,
        text: '#include "lib/math.slang"\nfloat sharedTone(float value) { return halfValue(value); }',
      },
    };
    try {
      await service.syncEnvironment(environment);
      await service.openDocument({ uri, languageId: "slang", version: 1, text: source });

      expect(await service.diagnostics({
        document: { uri, languageId: "slang", version: 1, environmentGeneration: 1 },
      })).toEqual([]);
    } finally {
      await service.dispose();
    }
  }, 20_000);

  it("narrows completions to vector components after a member selector", async () => {
    const wasmBinary = readFileSync(new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
    const module = await createSlangModule({ wasmBinary });
    const service = new SlangLanguageService(module);
    const uri = "file:///image.slang";
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
    try {
      await service.syncEnvironment(environment);
      const source = [
        "float4 mainImage(float2 p)",
        "{",
        "    float2 uv = p;",
        "    uv.",
        "    return float4(uv, 0.0, 1.0);",
        "}",
        "",
      ].join("\n");
      await service.openDocument({ uri, languageId: "slang", version: 1, text: source });
      const document = { uri, languageId: "slang" as const, version: 1, environmentGeneration: 1 };

      const completions = await service.completion({ document, position: { line: 3, character: 7 } });

      expect(completions.map((item) => item.label)).toEqual(["x", "y", "xy", "r", "g", "rg", "s", "t", "st"]);
      expect(completions.some((item) => item.label === "abs")).toBe(false);
    } finally {
      await service.dispose();
    }
  }, 20_000);
});
