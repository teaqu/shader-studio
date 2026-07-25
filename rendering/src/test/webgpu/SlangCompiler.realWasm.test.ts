// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { SlangModuleApi } from "../../webgpu/slangTypes";
import { SlangCompiler, PINNED_SLANG_COMPILER_VERSION } from "../../webgpu/SlangCompiler";
import { ShaderDebugger, VariableCaptureBuilder } from "@shader-studio/glsl-debug";

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
    } finally {
      compiler.dispose();
    }
  });

  it("fails an unsupported root version at the real root URI", () => {
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile(request("#language slang 2030\nfloat4 mainImage(float2 c) { return float4(1); }"));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.diagnostics?.[0]?.uri).toBe("file:///image.slang");
      }
    } finally {
      compiler.dispose();
    }
  });

  it("keeps directive-free imports legacy while textual includes inherit 2026", () => {
    const source = [
      "#language slang 2026",
      "module image;",
      "import legacy_dep;",
      "#include \"tuple-helper.slang\"",
      "float4 mainImage(float2 c) { return float4(legacyImportedValue() + tupleIncludedValue(), 0, 0, 1); }",
    ].join("\n");
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile(request(source, [
        { path: "/workspace/image.slang", uri: "file:///image.slang", source },
        { path: "/workspace/legacy_dep.slang", uri: "file:///legacy_dep.slang", source: "module legacy_dep; public float legacyImportedValue() { return (1.0, 2.0); }" },
        { path: "/workspace/tuple-helper.slang", uri: "file:///tuple-helper.slang", source: "float tupleIncludedValue() { let pair = (3.0, 4.0); return pair._0 + pair._1; }" },
      ]));
      expect(result).toMatchObject({ success: true, diagnostics: [] });
    } finally {
      compiler.dispose();
    }
  });

  it.each(["2025", "2026", "latest"] as const)("imports an explicit %s dependency", (version) => {
    const source = "#language slang 2026\nmodule image;\nimport dep;\nfloat4 mainImage(float2 c) { return float4(depValue(), 0, 0, 1); }";
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile(request(source, [
        { path: "/workspace/image.slang", uri: "file:///image.slang", source },
        { path: "/workspace/dep.slang", uri: "file:///dep.slang", source: `#language slang ${version}\nmodule dep;\npublic float depValue() { return 1.0; }` },
      ]));
      expect(result).toMatchObject({ success: true, diagnostics: [] });
    } finally {
      compiler.dispose();
    }
  });

  it("resolves a relative quoted module imported by a nested pass", () => {
    const source = [
      "#language slang 2026",
      "module history;",
      "import \"../lib/palette.slang\";",
      "float4 mainImage(float2 c) { return float4(paletteValue(), 0, 0, 1); }",
    ].join("\n");
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile({
        source,
        sourceUri: "file:///project/passes/history.slang",
        sourcePath: "/workspace/passes/history.slang",
        workspace: {
          rootUri: "file:///project",
          files: [
            { path: "/workspace/passes/history.slang", uri: "file:///project/passes/history.slang", source },
            {
              path: "/workspace/lib/palette.slang",
              uri: "file:///project/lib/palette.slang",
              source: "#language slang 2026\nmodule palette;\npublic float paletteValue() { return 1; }",
            },
          ],
        },
        options: { passName: "History" },
      });
      expect(result).toMatchObject({ success: true, diagnostics: [] });
    } finally {
      compiler.dispose();
    }
  });

  it("compiles normal, line-debug, and capture roots against one unchanged 2026 workspace", () => {
    const source = [
      "#language slang 2026",
      "module image;",
      "import dep;",
      "#include \"helper.slang\"",
      "float4 mainImage(float2 c) {",
      "  float value = depValue() + helperValue() + commonValue();",
      "  return float4(value, 0, 0, 1);",
      "}",
    ].join("\n");
    const workspace = {
      rootUri: "file:///project/image.slang",
      files: [
        { path: "/workspace/image.slang", uri: "file:///project/image.slang", source },
        { path: "/workspace/dep.slang", uri: "file:///project/dep.slang", source: "#language slang 2026\nmodule dep;\npublic float depValue() { return 1; }" },
        { path: "/workspace/helper.slang", uri: "file:///project/helper.slang", source: "float helperValue() { return 2; }" },
      ],
    };
    const debug = ShaderDebugger.modifyShaderForLineDebug(source, 5, "  float value = depValue() + helperValue() + commonValue();", new Map(), new Map(), "off", null, "slang");
    const capture = VariableCaptureBuilder.generateMultiCaptureShader(
      source, 5, [{ varName: "value", varType: "float", declarationLine: 5 }], new Map(), new Map(), false, 8, 8, "slang",
    );
    expect(debug).not.toBeNull();
    expect(capture).not.toBeNull();
    const snapshot = structuredClone(workspace);
    const compiler = new SlangCompiler(slang);
    try {
      for (const transformed of [source, debug!, capture!]) {
        const result = compiler.compile({
          source: transformed,
          sourceUri: "file:///project/image.slang",
          sourcePath: "/workspace/image.slang",
          workspace: {
            rootUri: workspace.rootUri,
            files: workspace.files.map((file) => file.path === "/workspace/image.slang" ? { ...file, source: transformed } : { ...file }),
          },
          options: { passName: "Image", commonCode: "float commonValue() { return 3; }", ...(transformed === capture ? { captureMode: true } : {}) },
        });
        expect(result).toMatchObject({ success: true, diagnostics: [] });
      }
      expect(workspace).toEqual(snapshot);
    } finally {
      compiler.dispose();
    }
  });

  it("maps a capture dependency diagnostic to its workspace file", () => {
    const source = "#language slang 2026\nmodule image;\nimport dep;\nfloat4 mainImage(float2 c) { return float4(depValue(), 0, 0, 1); }";
    const compiler = new SlangCompiler(slang);
    try {
      const result = compiler.compile(request(source, [
        { path: "/workspace/image.slang", uri: "file:///image.slang", source },
        { path: "/workspace/dep.slang", uri: "file:///dep.slang", source: "#language slang 2026\nmodule dep;\npublic float depValue() { return missingValue; }" },
      ]));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.diagnostics).toEqual(expect.arrayContaining([
          expect.objectContaining({ uri: "file:///dep.slang" }),
        ]));
      }
    } finally {
      compiler.dispose();
    }
  });
});
