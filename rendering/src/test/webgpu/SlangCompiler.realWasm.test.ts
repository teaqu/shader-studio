import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import createSlangModule from "../../../../ui/src/slang/slang-wasm.js";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type { SlangModuleApi } from "../../webgpu/slangTypes";

describe("SlangCompiler with bundled WASM", () => {
  it("compiles native imports and relative includes from the mounted workspace", async () => {
    const wasmPath = resolve(process.cwd(), "../ui/src/slang/slang-wasm.wasm");
    const wasmBinary = await readFile(wasmPath);
    const slang = await createSlangModule({ wasmBinary });
    const compiler = new SlangCompiler(slang as unknown as SlangModuleApi);
    const source = [
      "#language slang 2026",
      "module image;",
      "import palette;",
      "#include \"../lib/math.slang\"",
      "float4 mainImage(float2 c) { return float4(paletteColor() + includedValue(), 1.0); }",
    ].join("\n");

    const result = compiler.compile({
      source,
      sourceUri: "file:///project/passes/image.slang",
      sourcePath: "/workspace/passes/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/passes/image.slang", path: "/workspace/passes/image.slang", source },
          {
            uri: "file:///project/palette.slang",
            path: "/workspace/palette.slang",
            source: "#language slang 2026\nmodule palette;\npublic float3 paletteColor() { return float3(1, 0, 0); }",
          },
          {
            uri: "file:///project/lib/math.slang",
            path: "/workspace/lib/math.slang",
            source: "float3 includedValue() { return float3(0, 1, 0); }",
          },
        ],
      },
      options: { passName: "Image" },
    });

    expect(result).toMatchObject({ success: true, diagnostics: [] });
    if (result.success) {
      expect(result.wgsl).toContain("fragmentMain");
    }
  }, 30_000);
});
