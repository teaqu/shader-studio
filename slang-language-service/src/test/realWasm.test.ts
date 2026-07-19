import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import createSlangModule from "../../../ui/src/slang/slang-wasm.js";
import { createSlangApi } from "../embind";
import { SlangWorkspace } from "../SlangWorkspace";
import { PINNED_SLANG_COMPILER_VERSION } from "../version";

describe("bundled Slang WASM language server", () => {
  it(
    "loads imports from MEMFS and serves core language queries",
    async () => {
      const wasmPath = fileURLToPath(new URL("../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
      const wasmBinary = await readFile(wasmPath);
      const module = await createSlangModule({ wasmBinary });
      // The generated declarations accept binary-backed EmbindString values as
      // well as strings. The core intentionally narrows that boundary to the
      // string-only subset used by Shader Studio.
      const api = createSlangApi(module as unknown as Parameters<typeof createSlangApi>[0]);
      expect(api.getVersionString()).toBe(PINNED_SLANG_COMPILER_VERSION);

      const rootUri = "file:///smoke/root.slang";
      const source = [
        "#language slang 2026",
        "module root;",
        "import palette;",
        "float4 mainImage(float2 fragCoord) { return float4(paletteColor(), 1.0); }",
      ].join("\n");
      const workspace = new SlangWorkspace(api, {
        rootUri: "file:///smoke",
        files: [
          {
            uri: "file:///smoke/palette.slang",
            path: "palette.slang",
            source: [
              "#language slang 2026",
              "module palette;",
              "public float3 paletteColor() { return float3(1.0, 0.0, 0.0); }",
            ].join("\n"),
          },
          { uri: rootUri, path: "root.slang", source },
        ],
      });

      try {
        expect(workspace.openDocument(rootUri, source, 1)).toBe(true);
        expect(() => workspace.diagnostics(rootUri)).not.toThrow();
        expect(() => workspace.completion(rootUri, { line: 3, character: 60 })).not.toThrow();
        expect(() => workspace.definition(rootUri, { line: 3, character: 57 })).not.toThrow();
      } finally {
        workspace.dispose();
      }
    },
    30_000,
  );
});
