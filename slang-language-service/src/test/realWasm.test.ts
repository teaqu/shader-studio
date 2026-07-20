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
      expect(names).toEqual(["mainImage"]);
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

  it("keeps user-area reserved built-in conflicts visible while hiding suffix diagnostics", () => {
    const rootUri = "file:///redeclaration/image.slang";
    const source = [
      "#language slang 2026",
      "module image;",
      "float3 iResolution;",
      "float4 mainImage(float2 p) { return float4(iResolution, 1.0); }",
    ].join("\n");
    const workspace = new SlangWorkspace(api, {
      rootUri: "file:///redeclaration",
      files: [{ uri: rootUri, path: "image.slang", source }],
    });

    try {
      workspace.openDocument(rootUri, source, 1);
      const diagnostics = workspace.diagnostics(rootUri) ?? [];
      const rawEof = { line: 3, character: source.split("\n").at(-1)?.length ?? 0 };

      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.every(({ range }) => (
        range.start.line < rawEof.line
        || (range.start.line === rawEof.line && range.start.character < rawEof.character)
      ))).toBe(true);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toMatch(/ambiguous reference to 'iResolution'/i);
    } finally {
      workspace.dispose();
    }
  });

  it("keeps a genuine non-entry diagnostic located exactly at raw EOF", () => {
    const rootUri = "file:///eof/helper.slang";
    const source = [
      "#language slang 2026",
      "module helper;",
      "float helper(",
    ].join("\n");
    const rawEof = { line: 2, character: "float helper(".length };
    const workspace = new SlangWorkspace(api, {
      rootUri: "file:///eof",
      files: [{ uri: rootUri, path: "helper.slang", source }],
    });

    try {
      workspace.openDocument(rootUri, source, 1);
      expect(workspace.diagnostics(rootUri)).toEqual(expect.arrayContaining([
        expect.objectContaining({ range: expect.objectContaining({ start: rawEof }) }),
      ]));
    } finally {
      workspace.dispose();
    }
  });

  it("protects entry built-ins from trailing continued line comments", () => {
    const cases = [false, true].map((finalNewline) => {
      const entryLine = "float4 mainImage(float2 p) { return float4(iResolution, 1.0); } // trailing \\";
      const source = [
        "#language slang 2026",
        "module image;",
        entryLine,
      ].join("\n") + (finalNewline ? "\n" : "");
      const name = finalNewline ? "newline" : "eof";
      return { entryLine, source, name, uri: `file:///continued/${name}.slang` };
    });
    const workspace = new SlangWorkspace(api, {
      rootUri: "file:///continued",
      files: cases.map(({ name, source, uri }) => ({ uri, path: `${name}.slang`, source })),
    });

    try {
      for (const { entryLine, source, uri } of cases) {
        workspace.openDocument(uri, source, 1);
        expect(workspace.diagnostics(uri)).toEqual([]);
        expect(workspace.hover(uri, {
          line: 2,
          character: entryLine.indexOf("iResolution") + 1,
        })?.contents.value).toContain("float3 iResolution");
      }
    } finally {
      workspace.dispose();
    }
  });

  it("does not grant built-ins to a strict module with only an inactive entry declaration", () => {
    const rootUri = "file:///inactive/helper.slang";
    const source = [
      "#language slang 2026",
      "module helper;",
      "#if 0",
      "float4 mainImage(float2 p) { return 0.0; }",
      "#endif",
      "float helper() { return iResolution.x; }",
    ].join("\n");
    const workspace = new SlangWorkspace(api, {
      rootUri: "file:///inactive",
      files: [{ uri: rootUri, path: "helper.slang", source }],
    });

    try {
      workspace.openDocument(rootUri, source, 1);
      expect(workspace.diagnostics(rootUri)).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "30015" }),
      ]));
    } finally {
      workspace.dispose();
    }
  });

  it("keeps the generated context valid under every supported language version", () => {
    const cases = ["legacy", "2025", "2026", "latest"].map((version) => {
      const source = [
        `#language slang ${version}`,
        `module image_${version};`,
        "float4 mainImage(float2 p) { return float4(iResolution, 1.0); }",
      ].join("\n");
      return { source, version, uri: `file:///versions/${version}.slang` };
    });
    const workspace = new SlangWorkspace(api, {
      rootUri: "file:///versions",
      files: cases.map(({ source, version, uri }) => ({ uri, path: `${version}.slang`, source })),
    });

    try {
      for (const { source, uri } of cases) {
        workspace.openDocument(uri, source, 1);
        expect(workspace.diagnostics(uri)).toEqual([]);
      }
    } finally {
      workspace.dispose();
    }
  }, 30_000);
});
