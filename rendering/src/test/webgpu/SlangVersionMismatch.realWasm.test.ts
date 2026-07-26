// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { SlangModuleApi } from "../../webgpu/slangTypes";
import { SlangCompiler } from "../../webgpu/SlangCompiler";

let slang: SlangModuleApi;

beforeAll(async () => {
  const scriptUrl = new URL("../../../../ui/src/slang/slang-wasm.js", import.meta.url).href;
  const wasmUrl = new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url).href;
  const module = await import(scriptUrl) as { default: (options: { locateFile: () => string }) => Promise<SlangModuleApi> };
  slang = await module.default({ locateFile: () => wasmUrl });
}, 30_000);

describe("Slang version mismatch", () => {
  it("reports 2025 comma-expression code as invalid when declared as 2026", () => {
    const source = [
      "#language slang 2026",
      "module foundation_version_mismatch;",
      "",
      "float4 mainImage(float2 fragCoord)",
      "{",
      "    float2 uv = fragCoord / iResolution.xy;",
      "    float selected = (uv.x, uv.y);",
      "    return float4(selected, 0.0, 0.0, 1.0);",
      "}",
    ].join("\n");
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile({
        source,
        sourceUri: "file:///image.slang",
        sourcePath: "/workspace/image.slang",
        workspace: {
          rootUri: "file:///image.slang",
          files: [{ path: "/workspace/image.slang", uri: "file:///image.slang", source }],
        },
        options: { passName: "Image" },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.diagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({
            code: "E30019",
            uri: "file:///image.slang",
            message: "type mismatch in expression",
          }),
        ]));
      }
    } finally {
      compiler.dispose();
    }
  });
});
