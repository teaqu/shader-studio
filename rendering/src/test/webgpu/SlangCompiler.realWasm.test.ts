import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import createSlangModule from "../../../../ui/src/slang/slang-wasm.js";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type { SlangModuleApi } from "../../webgpu/slangTypes";

describe("SlangCompiler with bundled WASM", () => {
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
