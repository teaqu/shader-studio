import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import createSlangModule from "../../../ui/src/slang/slang-wasm.js";
import { createSlangApi } from "../embind";
import type { SlangApi } from "../slangApi";
import { SlangWorkspace, type DocumentSymbolDto } from "../SlangWorkspace";
import { PINNED_SLANG_COMPILER_VERSION } from "../version";

describe("bundled Slang WASM language server", () => {
  let api: SlangApi;

  beforeAll(async () => {
    const wasmPath = fileURLToPath(new URL("../../../ui/src/slang/slang-wasm.wasm", import.meta.url));
    const wasmBinary = await readFile(wasmPath);
    const module = await createSlangModule({ wasmBinary });
    // The generated declarations accept binary-backed EmbindString values as
    // well as strings. The core intentionally narrows that boundary to the
    // string-only subset used by Shader Studio.
    api = createSlangApi(module as unknown as Parameters<typeof createSlangApi>[0]);
  }, 30_000);

  it(
    "loads imports from MEMFS and serves core language queries",
    () => {
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
        expect(workspace.diagnostics(rootUri)).toEqual([]);
        expect(workspace.completion(rootUri, { line: 3, character: 57 })).toEqual(
          expect.arrayContaining([expect.objectContaining({ label: "paletteColor" })]),
        );
        expect(workspace.definition(rootUri, { line: 3, character: 57 })).toEqual([
          {
            uri: "file:///smoke/palette.slang",
            range: { start: { line: 2, character: 14 }, end: { line: 2, character: 26 } },
          },
        ]);
      } finally {
        workspace.dispose();
      }
    },
    30_000,
  );

  it("provides Shader Studio built-ins only to entry documents and hides generated results", () => {
    const rootUri = "file:///context/image.slang";
    const source = [
      "#language slang 2026",
      "module image;",
      "float4 mainImage(float2 p) {",
      "  float x = cos(iResolution.x);",
      "  return float4(x, p.x, 0.0, 1.0);",
      "}",
    ].join("\n");
    const workspace = new SlangWorkspace(api, {
      rootUri: "file:///context",
      files: [{ uri: rootUri, path: "image.slang", source }],
    });

    try {
      workspace.openDocument(rootUri, source, 1);

      expect(workspace.diagnostics(rootUri)).toEqual([]);
      expect(workspace.hover(rootUri, { line: 2, character: 1 })?.contents.value).toContain("float4");
      expect(workspace.hover(rootUri, { line: 3, character: 13 })?.contents.value).toContain("cos");
      expect(workspace.hover(rootUri, { line: 3, character: 17 })?.contents.value).toContain("float3 iResolution");

      const symbolNames = (symbols: DocumentSymbolDto[]): string[] => symbols.flatMap(
        (symbol) => [symbol.name, ...symbolNames(symbol.children)],
      );
      const names = symbolNames(workspace.documentSymbols(rootUri) ?? []);
      expect(names).toContain("mainImage");
      expect(names).not.toEqual(expect.arrayContaining([
        "iResolution",
        "iMouse",
        "iTime",
        "iTimeDelta",
        "iFrameRate",
        "iFrame",
        "iChannelTime",
        "iChannelLoaded",
        "iSampleRate",
        "iDate",
        "iChannelResolution",
        "iCameraPos",
        "iCameraDir",
      ]));
      expect(workspace.definition(rootUri, { line: 3, character: 17 }) ?? []).toEqual([]);
    } finally {
      workspace.dispose();
    }

    const helperUri = "file:///context/helper.slang";
    const helperSource = [
      "#language slang 2026",
      "module helper;",
      "float helper() { return iResolution.x; }",
    ].join("\n");
    const helperWorkspace = new SlangWorkspace(api, {
      rootUri: "file:///context",
      files: [{ uri: helperUri, path: "helper.slang", source: helperSource }],
    });

    try {
      helperWorkspace.openDocument(helperUri, helperSource, 1);
      expect(helperWorkspace.diagnostics(helperUri)).toEqual([
        expect.objectContaining({ code: "30015" }),
      ]);
    } finally {
      helperWorkspace.dispose();
    }
  });

  it.each(["legacy", "2025", "2026", "latest"])(
    "keeps the generated context valid under the %s language version",
    (version) => {
      const rootUri = `file:///versions/${version}.slang`;
      const source = [
        `#language slang ${version}`,
        `module image_${version};`,
        "float4 mainImage(float2 p) { return float4(iResolution, 1.0); }",
      ].join("\n");
      const workspace = new SlangWorkspace(api, {
        rootUri: "file:///versions",
        files: [{ uri: rootUri, path: `${version}.slang`, source }],
      });

      try {
        workspace.openDocument(rootUri, source, 1);
        expect(workspace.diagnostics(rootUri)).toEqual([]);
      } finally {
        workspace.dispose();
      }
    },
    30_000,
  );
});
