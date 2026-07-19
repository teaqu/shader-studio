import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import createSlangModule from "../../../../ui/src/slang/slang-wasm.js";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import { ShaderDebugger, VariableCaptureBuilder } from "@shader-studio/glsl-debug";
import type { SlangModuleApi } from "../../webgpu/slangTypes";

describe("SlangCompiler with bundled WASM", () => {
  it("compiles normal and line-debug roots with the same imported workspace identity", async () => {
    const wasmPath = resolve(process.cwd(), "../ui/src/slang/slang-wasm.wasm");
    const wasmBinary = await readFile(wasmPath);
    const slang = await createSlangModule({ wasmBinary });
    const source = [
      "#language slang 2026",
      "module image;",
      "import palette;",
      "#include \"included.slang\"",
      "float4 mainImage(float2 c) {",
      "  float value = importedValue() + includedValue() + configuredCommon();",
      "  return float4(value, value, value, 1.0);",
      "}",
    ].join("\n");
    const dependencies = [
      { uri: "file:///project/palette.slang", path: "/workspace/palette.slang", source: "module palette;\npublic float importedValue() { return 1.0; }" },
      { uri: "file:///project/included.slang", path: "/workspace/included.slang", source: "float includedValue() { return 2.0; }" },
    ];
    const workspace = {
      rootUri: "file:///project",
      files: [
        { uri: "file:///project/image.slang", path: "/workspace/image.slang", source },
        ...dependencies,
      ],
    };
    const debugSource = ShaderDebugger.modifyShaderForLineDebug(
      source,
      5,
      source.split("\n")[5],
      new Map(),
      new Map(),
      "off",
      null,
      "slang",
    );
    expect(debugSource).not.toBeNull();
    expect(debugSource?.split("\n").slice(0, 4)).toEqual(source.split("\n").slice(0, 4));
    expect(debugSource).toContain("float value = importedValue() + includedValue() + configuredCommon();");
    expect(debugSource).toContain("return float4(float3(value), 1.0);");
    const compiler = new SlangCompiler(slang as unknown as SlangModuleApi);
    const options = { passName: "Image", commonCode: "float configuredCommon() { return 3.0; }" };

    const normal = compiler.compile({
      source,
      sourceUri: workspace.files[0].uri,
      sourcePath: workspace.files[0].path,
      workspace,
      options,
    });
    const debug = compiler.compile({
      source: debugSource!,
      sourceUri: workspace.files[0].uri,
      sourcePath: workspace.files[0].path,
      workspace,
      options,
    });

    expect(normal.success).toBe(true);
    expect(debug.success).toBe(true);
    expect(workspace.files[0].source).toBe(source);
    expect(workspace.files.slice(1)).toEqual(dependencies);
    compiler.dispose();
  }, 30_000);

  it("compiles normal and instrumented roots with imports, includes, and common code", async () => {
    const wasmPath = resolve(process.cwd(), "../ui/src/slang/slang-wasm.wasm");
    const wasmBinary = await readFile(wasmPath);
    const slang = await createSlangModule({ wasmBinary });
    const source = [
      "#language slang 2026",
      "module image;",
      "import palette;",
      "#include \"included.slang\"",
      "float4 mainImage(float2 c) {",
      "  float value = importedValue() + includedValue() + configuredCommon();",
      "  return float4(value, value, value, 1.0);",
      "}",
    ].join("\n");
    const dependencies = [
      { uri: "file:///project/palette.slang", path: "/workspace/palette.slang", source: "module palette;\npublic float importedValue() { return 1.0; }" },
      { uri: "file:///project/included.slang", path: "/workspace/included.slang", source: "float includedValue() { return 2.0; }" },
    ];
    const workspace = {
      rootUri: "file:///project",
      files: [
        { uri: "file:///project/image.slang", path: "/workspace/image.slang", source },
        ...dependencies,
      ],
    };
    const transformed = VariableCaptureBuilder.generateMultiCaptureShader(
      source,
      5,
      [{ varName: "value", varType: "float", declarationLine: 5 }],
      new Map(),
      new Map(),
      false,
      8,
      8,
      "slang",
    );
    expect(transformed).not.toBeNull();
    expect(transformed?.split("\n").slice(0, 4)).toEqual(source.split("\n").slice(0, 4));
    const compiler = new SlangCompiler(slang as unknown as SlangModuleApi);
    const options = { passName: "Image", commonCode: "float configuredCommon() { return 3.0; }" };

    const normal = compiler.compile({
      source, sourceUri: workspace.files[0].uri, sourcePath: workspace.files[0].path, workspace, options,
    });
    const instrumented = compiler.compile({
      source: transformed!,
      sourceUri: workspace.files[0].uri,
      sourcePath: workspace.files[0].path,
      // Runtime debug compilation carries the original snapshot unchanged;
      // loadModuleFromSource receives the selected transformed root directly.
      workspace,
      options: { ...options, captureMode: true },
    });

    expect(normal.success).toBe(true);
    expect(instrumented.success).toBe(true);
    expect(workspace.files.slice(1)).toEqual(dependencies);
    expect(workspace.files[0].source).toBe(source);
    compiler.dispose();
  }, 30_000);

  it("keeps directive-free imports legacy while includes inherit a 2026 root", async () => {
    const wasmPath = resolve(process.cwd(), "../ui/src/slang/slang-wasm.wasm");
    const wasmBinary = await readFile(wasmPath);
    const slang = await createSlangModule({ wasmBinary });
    const source = [
      "#language slang 2026",
      "module image;",
      "import legacy_dep;",
      "#include \"../tuple-helper.slang\"",
      "float4 mainImage(float2 c) {",
      "  return float4(legacyImportedValue() + includedTupleValue(), 0.0, 0.0, 1.0);",
      "}",
    ].join("\n");
    const request = {
      source,
      sourceUri: "file:///project/passes/image.slang",
      sourcePath: "/workspace/passes/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/passes/image.slang", path: "/workspace/passes/image.slang", source },
          {
            uri: "file:///project/legacy_dep.slang",
            path: "/workspace/legacy_dep.slang",
            // Imported modules are independent translation units, so this
            // directive-free file selects legacy comma-expression semantics.
            source: "module legacy_dep;\npublic float legacyImportedValue() { return (1.0, 2.0); }",
          },
          {
            uri: "file:///project/tuple-helper.slang",
            path: "/workspace/tuple-helper.slang",
            // Textual includes inherit the including root's 2026 mode, where
            // the same comma syntax creates a tuple with _0/_1 members.
            source: [
              "float includedTupleValue() {",
              "  let pair = (3.0, 4.0);",
              "  return pair._0 + pair._1;",
              "}",
            ].join("\n"),
          },
        ],
      },
      options: { passName: "Image" },
    };

    // Repeated construction/compilation/disposal exercises the real Embind
    // ownership path, including idempotent global-session disposal.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const compiler = new SlangCompiler(slang as unknown as SlangModuleApi);
      const first = compiler.compile(request);
      const second = compiler.compile(request);
      expect(first).toMatchObject({ success: true, diagnostics: [] });
      expect(second).toMatchObject({ success: true, diagnostics: [] });
      if (first.success) {
        expect(first.wgsl).toContain("fragmentMain");
      }
      compiler.dispose();
      expect(() => compiler.dispose()).not.toThrow();
    }

    const explicitCompiler = new SlangCompiler(slang as unknown as SlangModuleApi);
    const explicit2026 = explicitCompiler.compile({
      ...request,
      workspace: {
        ...request.workspace,
        files: request.workspace.files.map((file) => file.path === "/workspace/legacy_dep.slang"
          ? { ...file, source: `#language slang 2026\n${file.source}` }
          : file),
      },
    });
    expect(explicit2026.success).toBe(false);
    expect(explicit2026.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "E30019" }),
    ]));
    explicitCompiler.dispose();
  }, 30_000);
});
