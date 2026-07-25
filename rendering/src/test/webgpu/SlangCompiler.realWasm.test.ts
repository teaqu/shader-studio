// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { SlangModuleApi } from "../../webgpu/slangTypes";
import { SlangCompiler, PINNED_SLANG_COMPILER_VERSION } from "../../webgpu/SlangCompiler";

let slang: SlangModuleApi;

beforeAll(async () => {
  const scriptUrl = new URL("../../../../ui/src/slang/slang-wasm.js", import.meta.url).href;
  const wasmUrl = new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url).href;
  const module = await import(scriptUrl) as { default: (options: { locateFile: () => string }) => Promise<SlangModuleApi> };
  slang = await module.default({ locateFile: () => wasmUrl });
}, 30_000);

function request(source: string, files = [{ path: "/workspace/image.slang", uri: "file:///image.slang", source }]) {
  return { source, sourceUri: "file:///image.slang", sourcePath: "/workspace/image.slang", workspace: { rootUri: "file:///image.slang", files }, options: { passName: "Image" } };
}

describe("SlangCompiler real WASM", () => {
  it("uses the pinned compiler", () => expect(slang.getVersionString?.()).toBe(PINNED_SLANG_COMPILER_VERSION));

  it.each([
    ["directive-free legacy", ""],
    ["explicit legacy", "#language slang legacy\n"],
    ["2025", "#language slang 2025\nmodule image;\n"],
    ["2026", "#language slang 2026\nmodule image;\n"],
    ["latest", "#language slang latest\nmodule image;\n"],
  ])("compiles %s roots", (_name, header) => {
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile(request(`${header}float4 mainImage(float2 c) { return float4(1); }`));
      expect(result).toMatchObject({ success: true, diagnostics: [] });
    } finally { compiler.dispose(); }
  });

  it("fails an unsupported root version at the real root URI", () => {
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile(request("#language slang 2030\nfloat4 mainImage(float2 c) { return float4(1); }"));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.diagnostics?.[0]?.uri).toBe("file:///image.slang");
    } finally { compiler.dispose(); }
  });

  it("compiles a 2026 root using a mounted module import and textual include", () => {
    const source = [
      "#language slang 2026",
      "module image;",
      "import palette;",
      "#include \"../lib/math.slang\"",
      "float4 mainImage(float2 c) { return float4(paletteColor() + includedValue(), 1.0); }",
    ].join("\n");
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile({ ...request(source, [
        { path: "/workspace/passes/image.slang", uri: "file:///passes/image.slang", source },
        { path: "/workspace/passes/palette.slang", uri: "file:///passes/palette.slang", source: "#language slang 2026\nmodule palette;\npublic float3 paletteColor() { return float3(1, 0, 0); }" },
        { path: "/workspace/lib/math.slang", uri: "file:///lib/math.slang", source: "float3 includedValue() { return float3(0, 1, 0); }" },
      ]), sourceUri: "file:///passes/image.slang", sourcePath: "/workspace/passes/image.slang" });
      expect(result).toMatchObject({ success: true, diagnostics: [] });
    } finally { compiler.dispose(); }
  });
});
