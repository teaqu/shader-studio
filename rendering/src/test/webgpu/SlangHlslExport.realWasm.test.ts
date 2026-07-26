// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { SlangModuleApi } from "../../webgpu/slangTypes";
import { SlangCompiler } from "../../webgpu/SlangCompiler";

let slang: SlangModuleApi;

beforeAll(async () => {
  const scriptUrl = new URL("../../../../ui/src/slang/slang-wasm.js", import.meta.url).href;
  const wasmUrl = new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url).href;
  const module = await import(scriptUrl) as {
    default: (options: { locateFile: () => string }) => Promise<SlangModuleApi>;
  };
  slang = await module.default({ locateFile: () => wasmUrl });
}, 30_000);

describe("Slang HLSL export with real WASM", () => {
  it("emits a complete HLSL program from an Image pass with an imported dependency", () => {
    const source = [
      "#language slang 2026",
      "module image;",
      "import palette;",
      "float4 mainImage(float2 c) { return float4(paletteValue(), c, 1); }",
    ].join("\n");
    const compiler = new SlangCompiler(slang);

    try {
      const result = compiler.compileTarget({
        source,
        sourceUri: "file:///project/image.slang",
        sourcePath: "/workspace/image.slang",
        workspace: {
          rootUri: "file:///project",
          files: [
            { path: "/workspace/image.slang", uri: "file:///project/image.slang", source },
            {
              path: "/workspace/palette.slang",
              uri: "file:///project/palette.slang",
              source: [
                "#language slang 2026",
                "module palette;",
                "public float paletteValue() { return 0.375; }",
              ].join("\n"),
            },
          ],
        },
        options: { passName: "Image" },
      }, "HLSL");

      expect(result).toMatchObject({
        success: true,
        target: "HLSL",
        diagnostics: [],
      });
      if (result.success) {
        expect(result.code).toContain("vertexMain");
        expect(result.code).toContain("fragmentMain");
        expect(result.code).toMatch(/SV_Position/i);
        expect(result.code).toMatch(/SV_Target/i);
      }
    } finally {
      compiler.dispose();
    }
  });
});
