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
    await service.openDocument({ uri, languageId: "slang", version: 1, text: "float4 mainImage(float2 p) { return float4(normalize(tint), 1.0); }" });
    const document = { uri, languageId: "slang" as const, version: 1, environmentGeneration: 1 };
    const completions = await service.completion({ document, position: { line: 0, character: 48 } });
    expect(completions.some((item) => item.label === "normalize")).toBe(true);
    expect(await service.diagnostics({ document })).toEqual([]);
    await service.changeDocument({ uri, languageId: "slang", version: 2, text: "float4 mainImage(float2 p) { return badName; }" });
    const invalidDocument = { ...document, version: 2 };
    const diagnostics = await service.diagnostics({ document: invalidDocument });
    expect(diagnostics[0]?.message).toContain("undefined identifier");
    expect(diagnostics[0]?.range.start).toEqual({ line: 0, character: 36 });
    await service.dispose();
  }, 20_000);
});
