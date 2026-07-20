import { describe, expect, it, vi } from "vitest";

import { createShaderStudioAnalysisSource } from "../shaderStudioContext";
import { SlangWorkspace } from "../SlangWorkspace";
import type {
  SlangApi,
  SlangDocumentSymbol,
  SlangList,
  SlangSignatureInformation,
} from "../slangApi";

function fakeList<T>(items: T[], failAt?: number): SlangList<T> & { delete: ReturnType<typeof vi.fn> } {
  return {
    size: () => items.length,
    get: (index: number) => {
      if (index === failAt) {
        throw new Error("copy failed");
      }
      return items[index];
    },
    delete: vi.fn(),
  };
}

function createFakeFs() {
  const files = new Set<string>();
  return {
    files,
    mkdirTree: vi.fn(),
    writeFile: vi.fn((path: string) => files.add(path)),
    unlink: vi.fn((path: string) => files.delete(path)),
    analyzePath: vi.fn((path: string) => ({ exists: files.has(path) })),
  };
}

function createFixture(fs = createFakeFs()) {
  const calls: string[] = [];
  const edits = fakeList<never>([]);
  const pushEdit = vi.fn();
  const stringLists: Array<SlangList<string> & { delete: ReturnType<typeof vi.fn>; push_back: ReturnType<typeof vi.fn> }> = [];
  const server = {
    didOpenTextDocument: vi.fn((path: string) => calls.push(`open:${path}`)),
    didCloseTextDocument: vi.fn((path: string) => calls.push(`close:${path}`)),
    didChangeTextDocument: vi.fn((path: string) => calls.push(`change:${path}`)),
    hover: vi.fn(),
    gotoDefinition: vi.fn(),
    completion: vi.fn(),
    completionResolve: vi.fn(),
    signatureHelp: vi.fn(),
    documentSymbol: vi.fn(),
    getDiagnostics: vi.fn(),
    delete: vi.fn(),
  };
  const api: SlangApi = {
    FS: fs,
    TextEditList: vi.fn(() => ({ ...edits, push_back: pushEdit })),
    StringList: vi.fn(() => {
      const values: string[] = [];
      const list = {
        ...fakeList(values),
        push_back: vi.fn((value: string) => values.push(value)),
      };
      stringLists.push(list);
      return list;
    }),
    createLanguageServer: vi.fn(() => server),
    getVersionString: vi.fn(() => "2026.10.2"),
  };
  const workspace = new SlangWorkspace(api, {
    rootUri: "file:///project",
    files: [
      { uri: "file:///project/root.slang", path: "root.slang", source: "old\nsource" },
      { uri: "file:///project/lib/palette.slang", path: "lib/palette.slang", source: "module palette;" },
    ],
  });
  return { api, calls, edits, fs, pushEdit, server, stringLists, workspace };
}

describe("SlangWorkspace document lifecycle", () => {
  it("opens entry documents with language context while keeping raw MEMFS bytes", () => {
    const source = "float4 mainImage(float2 p) { return iResolution.x; }";
    const { fs, server, workspace } = createFixture();

    expect(workspace.openDocument("file:///project/root.slang", source, 1)).toBe(true);

    expect(server.didOpenTextDocument).toHaveBeenCalledWith(
      "file:///workspace/root.slang",
      createShaderStudioAnalysisSource(source),
    );
    expect(fs.writeFile).toHaveBeenLastCalledWith("/workspace/root.slang", source);
  });

  it("replaces the previous analysis overlay through its EOF while storing the next raw source", () => {
    const first = "float4 mainImage(float2 p) { return iResolution.x; }";
    const second = "module helper;\nfloat helper() { return 1.0; }";
    const firstAnalysis = createShaderStudioAnalysisSource(first);
    const { fs, pushEdit, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", first, 1);

    expect(workspace.changeDocument("file:///project/root.slang", second, 2)).toBe(true);

    const analysisLines = firstAnalysis.split("\n");
    expect(pushEdit).toHaveBeenCalledWith({
      range: {
        start: { line: 0, character: 0 },
        end: { line: analysisLines.length - 1, character: analysisLines.at(-1)?.length ?? 0 },
      },
      text: second,
    });
    expect(fs.writeFile).toHaveBeenLastCalledWith("/workspace/root.slang", second);
  });

  it("sends the next analysis source when a change turns a module into an entry document", () => {
    const source = "float4 mainImage(float2 p) { return iResolution.x; }";
    const { pushEdit, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", "module helper;", 1);

    expect(workspace.changeDocument("file:///project/root.slang", source, 2)).toBe(true);

    expect(pushEdit).toHaveBeenCalledWith(expect.objectContaining({
      text: createShaderStudioAnalysisSource(source),
    }));
  });

  it("orders open, accepted change, and close with canonical paths", () => {
    const { calls, edits, server, workspace } = createFixture();

    expect(workspace.openDocument("file:///project/root.slang", "old\nsource", 1)).toBe(true);
    expect(workspace.changeDocument("file:///project/root.slang", "new", 2)).toBe(true);
    expect(workspace.closeDocument("file:///project/root.slang", 2)).toBe(true);

    expect(calls).toEqual([
      "open:file:///workspace/root.slang",
      "change:file:///workspace/root.slang",
      "close:file:///workspace/root.slang",
    ]);
    expect(server.didChangeTextDocument).toHaveBeenCalledWith(
      "file:///workspace/root.slang",
      expect.objectContaining({ delete: edits.delete }),
    );
    expect(edits.delete).toHaveBeenCalledOnce();
  });

  it("rejects stale and out-of-order versions without calling Embind", () => {
    const { calls, workspace } = createFixture();

    expect(workspace.openDocument("file:///project/root.slang", "one", 3)).toBe(true);
    expect(workspace.changeDocument("file:///project/root.slang", "stale", 2)).toBe(false);
    expect(workspace.changeDocument("file:///project/root.slang", "same", 3)).toBe(false);
    expect(workspace.closeDocument("file:///project/root.slang", 2)).toBe(false);

    expect(calls).toEqual(["open:file:///workspace/root.slang"]);
  });

  it("deletes a text-edit handle when didChange throws", () => {
    const { edits, server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", "one", 1);
    server.didChangeTextDocument.mockImplementation(() => {
      throw new Error("native failure");
    });

    expect(() => workspace.changeDocument("file:///project/root.slang", "two", 2)).toThrow("native failure");
    expect(edits.delete).toHaveBeenCalledOnce();
  });

  it("restores the workspace snapshot in MEMFS when an unsaved document closes", () => {
    const { fs, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", "unsaved", 1);

    workspace.closeDocument("file:///project/root.slang", 1);

    expect(fs.writeFile).toHaveBeenCalledWith("/workspace/root.slang", "old\nsource");
  });

  it("is terminal and idempotent after disposal", () => {
    const { server, workspace } = createFixture();

    workspace.dispose();
    workspace.dispose();

    expect(server.delete).toHaveBeenCalledOnce();
    expect(() => workspace.hover("file:///project/root.slang", { line: 0, character: 0 })).toThrow("disposed");
    expect(() => workspace.openDocument("file:///project/root.slang", "source", 1)).toThrow("disposed");
  });

  it("remounts its snapshot before a query after another workspace takes the shared filesystem", () => {
    const fs = createFakeFs();
    const first = createFixture(fs);
    const second = createFixture(fs);
    fs.writeFile.mockClear();

    first.workspace.hover("file:///project/root.slang", { line: 0, character: 0 });

    expect(fs.writeFile).toHaveBeenCalledWith("/workspace/root.slang", "old\nsource");
    expect(fs.writeFile).toHaveBeenCalledWith("/workspace/lib/palette.slang", "module palette;");
    second.workspace.dispose();
    first.workspace.dispose();
  });

  it("removes MEMFS paths on dispose only while it owns the shared filesystem", () => {
    const fs = createFakeFs();
    const first = createFixture(fs);
    const second = createFixture(fs);

    first.workspace.dispose();
    expect(fs.files).toEqual(new Set(["/workspace/root.slang", "/workspace/lib/palette.slang"]));

    second.workspace.dispose();
    expect(fs.files).toEqual(new Set());
  });
});

describe("SlangWorkspace replacement", () => {
  it("reopens a remapped entry document with its analysis source while MEMFS stays raw", () => {
    const source = "float4 mainImage(float2 p) { return iResolution.x; }";
    const { fs, server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", source, 1);
    server.didOpenTextDocument.mockClear();

    workspace.replaceFiles({
      rootUri: "file:///project",
      files: [{ uri: "file:///project/root.slang", path: "moved/root.slang", source }],
    });

    expect(server.didCloseTextDocument).toHaveBeenCalledWith("file:///workspace/root.slang");
    expect(server.didOpenTextDocument).toHaveBeenCalledWith(
      "file:///workspace/moved/root.slang",
      createShaderStudioAnalysisSource(source),
    );
    expect(fs.writeFile).toHaveBeenLastCalledWith("/workspace/moved/root.slang", source);
  });

  it("keeps an open overlay across a disk-baseline replacement and restores the new baseline on close", () => {
    const { fs, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", "unsaved overlay", 1);

    workspace.replaceFiles({
      rootUri: "file:///project",
      files: [{ uri: "file:///project/root.slang", path: "root.slang", source: "saved disk baseline" }],
    });
    expect(fs.writeFile).toHaveBeenLastCalledWith("/workspace/root.slang", "unsaved overlay");

    expect(workspace.closeDocument("file:///project/root.slang", 1)).toBe(true);
    expect(fs.writeFile).toHaveBeenLastCalledWith("/workspace/root.slang", "saved disk baseline");
  });

  it("drops removed mappings and permits their paths to be reused", () => {
    const { server, workspace } = createFixture();
    server.hover.mockReturnValue(undefined);

    workspace.replaceFiles({
      rootUri: "file:///project",
      files: [{ uri: "file:///project/replacement.slang", path: "lib/palette.slang", source: "replacement" }],
    });

    expect(() => workspace.hover("file:///project/lib/palette.slang", { line: 0, character: 0 })).toThrow("not mapped");
    expect(() => workspace.hover("file:///project/root.slang", { line: 0, character: 0 })).toThrow("not mapped");
    workspace.hover("file:///project/replacement.slang", { line: 0, character: 0 });
    expect(server.hover).toHaveBeenLastCalledWith("file:///workspace/lib/palette.slang", { line: 0, character: 0 });
  });

  it("uses a changed path for the same URI", () => {
    const { server, workspace } = createFixture();
    server.hover.mockReturnValue(undefined);

    workspace.replaceFiles({
      rootUri: "file:///project",
      files: [{ uri: "file:///project/root.slang", path: "moved/root.slang", source: "source" }],
    });
    workspace.hover("file:///project/root.slang", { line: 0, character: 0 });

    expect(server.hover).toHaveBeenLastCalledWith("file:///workspace/moved/root.slang", { line: 0, character: 0 });
  });

  it("keeps a removed open document mapped until close, then removes its MEMFS file", () => {
    const { fs, server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", "unsaved", 1);
    server.hover.mockReturnValue(undefined);

    workspace.replaceFiles({ rootUri: "file:///project", files: [] });
    workspace.hover("file:///project/root.slang", { line: 0, character: 0 });
    expect(server.hover).toHaveBeenLastCalledWith("file:///workspace/root.slang", { line: 0, character: 0 });
    expect(workspace.closeDocument("file:///project/root.slang", 1)).toBe(true);
    expect(fs.unlink).toHaveBeenCalledWith("/workspace/root.slang");
    expect(() => workspace.hover("file:///project/root.slang", { line: 0, character: 0 })).toThrow("not mapped");
  });

  it("validates a replacement before mutating paths or MEMFS", () => {
    const { fs, server, workspace } = createFixture();
    const writesBefore = fs.writeFile.mock.calls.length;
    server.hover.mockReturnValue(undefined);

    expect(() =>
      workspace.replaceFiles({
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/one.slang", path: "duplicate.slang", source: "one" },
          { uri: "file:///project/two.slang", path: "duplicate.slang", source: "two" },
        ],
      }),
    ).toThrow("already mapped");
    expect(fs.writeFile).toHaveBeenCalledTimes(writesBefore);
    workspace.hover("file:///project/root.slang", { line: 0, character: 0 });
    expect(server.hover).toHaveBeenLastCalledWith("file:///workspace/root.slang", { line: 0, character: 0 });
  });
});

describe("SlangWorkspace query copying", () => {
  it("keeps augmented diagnostics at raw EOF while filtering diagnostics after it", () => {
    const source = "float4 mainImage(float2 p) { return iResolution.x; }";
    const rawEnd = { line: 0, character: source.length };
    const diagnostics = fakeList([
      {
        code: "user",
        severity: 1,
        message: "user diagnostic",
        range: { start: { line: 0, character: 7 }, end: { line: 0, character: 16 } },
      },
      {
        code: "at-eof",
        severity: 1,
        message: "user diagnostic at EOF",
        range: { start: rawEnd, end: rawEnd },
      },
      {
        code: "suffix",
        severity: 1,
        message: "generated diagnostic in suffix",
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
      },
    ]);
    const { server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", source, 1);
    server.getDiagnostics.mockReturnValue(diagnostics);

    expect(workspace.diagnostics("file:///project/root.slang")).toEqual([
      expect.objectContaining({ code: "user" }),
      expect.objectContaining({ code: "at-eof" }),
    ]);
    expect(diagnostics.delete).toHaveBeenCalledOnce();
  });

  it("does not filter an unaugmented diagnostic exactly at raw EOF", () => {
    const source = "module helper;";
    const diagnostic = {
      code: "eof",
      severity: 1,
      message: "unexpected EOF",
      range: {
        start: { line: 0, character: source.length },
        end: { line: 0, character: source.length },
      },
    };
    const diagnostics = fakeList([diagnostic]);
    const { server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", source, 1);
    server.getDiagnostics.mockReturnValue(diagnostics);

    expect(workspace.diagnostics("file:///project/root.slang")).toEqual([diagnostic]);
  });

  it("filters only same-document definitions beginning after raw EOF", () => {
    const source = "float4 mainImage(float2 p) { return iResolution.x; }";
    const locations = fakeList([
      {
        uri: "file:///workspace/root.slang",
        range: { start: { line: 0, character: 7 }, end: { line: 0, character: 16 } },
      },
      {
        uri: "file:///workspace/root.slang",
        range: {
          start: { line: 0, character: source.length },
          end: { line: 0, character: source.length },
        },
      },
      {
        uri: "file:///workspace/root.slang",
        range: { start: { line: 1, character: 14 }, end: { line: 1, character: 25 } },
      },
      {
        uri: "file:///workspace/lib/palette.slang",
        range: { start: { line: 40, character: 0 }, end: { line: 40, character: 11 } },
      },
    ]);
    const { server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", source, 1);
    server.gotoDefinition.mockReturnValue(locations);

    expect(workspace.definition("file:///project/root.slang", { line: 0, character: 39 })).toEqual([
      expect.objectContaining({ uri: "file:///project/root.slang", range: expect.objectContaining({ start: { line: 0, character: 7 } }) }),
      expect.objectContaining({ uri: "file:///project/root.slang", range: expect.objectContaining({ start: { line: 0, character: source.length } }) }),
      expect.objectContaining({ uri: "file:///project/lib/palette.slang", range: expect.objectContaining({ start: { line: 40, character: 0 } }) }),
    ]);
    expect(locations.delete).toHaveBeenCalledOnce();
  });

  it("does not filter same-document definition locations in an unaugmented document", () => {
    const source = "module helper;";
    const locations = fakeList([{
      uri: "file:///workspace/root.slang",
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 6 } },
    }]);
    const { server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", source, 1);
    server.gotoDefinition.mockReturnValue(locations);

    expect(workspace.definition("file:///project/root.slang", { line: 0, character: 0 })).toEqual([{
      uri: "file:///project/root.slang",
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 6 } },
    }]);
  });

  it("recursively removes generated document symbols while preserving valid user trees", () => {
    const source = "float4 mainImage(float2 p) { return iResolution.x; }";
    const validChildren = fakeList<SlangDocumentSymbol>([
      {
        name: "field",
        detail: "float",
        kind: 13,
        range: { start: { line: 0, character: 8 }, end: { line: 0, character: 13 } },
        selectionRange: { start: { line: 0, character: 8 }, end: { line: 0, character: 13 } },
        children: fakeList([]),
      },
      {
        name: "iResolution",
        detail: "float3",
        kind: 13,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 26 } },
        selectionRange: { start: { line: 1, character: 14 }, end: { line: 1, character: 25 } },
        children: fakeList([]),
      },
    ]);
    const roots = fakeList<SlangDocumentSymbol>([
      {
        name: "mainImage",
        detail: "function",
        kind: 12,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 55 } },
        selectionRange: { start: { line: 0, character: 7 }, end: { line: 0, character: 16 } },
        children: validChildren,
      },
      {
        name: "eof-marker",
        detail: "user EOF symbol",
        kind: 13,
        range: { start: { line: 0, character: source.length }, end: { line: 0, character: source.length } },
        selectionRange: { start: { line: 0, character: source.length }, end: { line: 0, character: source.length } },
        children: fakeList([]),
      },
      {
        name: "iMouse",
        detail: "float4",
        kind: 13,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 21 } },
        selectionRange: { start: { line: 2, character: 14 }, end: { line: 2, character: 20 } },
        children: fakeList([]),
      },
    ]);
    const { server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", source, 1);
    server.documentSymbol.mockReturnValue(roots);

    expect(workspace.documentSymbols("file:///project/root.slang")).toEqual([
      expect.objectContaining({
        name: "mainImage",
        children: [expect.objectContaining({ name: "field" })],
      }),
      expect.objectContaining({ name: "eof-marker" }),
    ]);
    expect(roots.delete).toHaveBeenCalledOnce();
    expect(validChildren.delete).toHaveBeenCalledOnce();
  });

  it("does not filter document symbols in an unaugmented document", () => {
    const roots = fakeList<SlangDocumentSymbol>([{
      name: "external-symbol",
      detail: "unchanged",
      kind: 13,
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 15 } },
      selectionRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 15 } },
      children: fakeList([]),
    }]);
    const { server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", "module helper;", 1);
    server.documentSymbol.mockReturnValue(roots);

    expect(workspace.documentSymbols("file:///project/root.slang")).toEqual([
      expect.objectContaining({ name: "external-symbol" }),
    ]);
  });

  it("promotes valid user symbols nested beneath a generated parent", () => {
    const userChildren = fakeList<SlangDocumentSymbol>([
      {
        name: "mainImage",
        detail: "function",
        kind: 12,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 52 } },
        selectionRange: { start: { line: 0, character: 7 }, end: { line: 0, character: 16 } },
        children: fakeList([]),
      },
    ]);
    const roots = fakeList<SlangDocumentSymbol>([
      {
        name: "generated-container",
        detail: "generated",
        kind: 2,
        range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
        selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 19 } },
        children: userChildren,
      },
    ]);
    const source = "float4 mainImage(float2 p) { return iResolution.x; }";
    const { server, workspace } = createFixture();
    workspace.openDocument("file:///project/root.slang", source, 1);
    server.documentSymbol.mockReturnValue(roots);

    expect(workspace.documentSymbols("file:///project/root.slang")).toEqual([
      expect.objectContaining({ name: "mainImage", children: [] }),
    ]);
    expect(roots.delete).toHaveBeenCalledOnce();
    expect(userChildren.delete).toHaveBeenCalledOnce();
  });

  it("preserves zero-based hover coordinates and undefined results", () => {
    const { server, workspace } = createFixture();
    server.hover.mockReturnValueOnce(undefined).mockReturnValueOnce({
      contents: { kind: "markdown", value: "value" },
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 2 } },
    });

    expect(workspace.hover("file:///project/root.slang", { line: 0, character: 0 })).toBeUndefined();
    expect(workspace.hover("file:///project/root.slang", { line: 0, character: 0 })).toEqual({
      contents: { kind: "markdown", value: "value" },
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 2 } },
    });
  });

  it("distinguishes undefined lists from empty lists and maps definition paths back to URIs", () => {
    const { server, workspace } = createFixture();
    const empty = fakeList([]);
    const locations = fakeList([
      {
        uri: "file:///workspace/lib/palette.slang",
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
      },
    ]);
    server.gotoDefinition.mockReturnValueOnce(undefined).mockReturnValueOnce(empty).mockReturnValueOnce(locations);

    expect(workspace.definition("file:///project/root.slang", { line: 0, character: 0 })).toBeUndefined();
    expect(workspace.definition("file:///project/root.slang", { line: 0, character: 0 })).toEqual([]);
    expect(workspace.definition("file:///project/root.slang", { line: 0, character: 0 })).toEqual([
      {
        uri: "file:///project/lib/palette.slang",
        range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
      },
    ]);
    expect(empty.delete).toHaveBeenCalledOnce();
    expect(locations.delete).toHaveBeenCalledOnce();
  });

  it("recursively copies document symbols and deletes every nested handle", () => {
    const childChildren = fakeList<SlangDocumentSymbol>([]);
    const children = fakeList<SlangDocumentSymbol>([
      {
        name: "member",
        detail: "float",
        kind: 13,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
        selectionRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
        children: childChildren,
      },
    ]);
    const roots = fakeList<SlangDocumentSymbol>([
      {
        name: "Palette",
        detail: "struct",
        kind: 23,
        range: { start: { line: 1, character: 0 }, end: { line: 3, character: 1 } },
        selectionRange: { start: { line: 1, character: 7 }, end: { line: 1, character: 14 } },
        children,
      },
    ]);
    const { server, workspace } = createFixture();
    server.documentSymbol.mockReturnValue(roots);

    expect(workspace.documentSymbols("file:///project/root.slang")).toEqual([
      expect.objectContaining({
        name: "Palette",
        children: [expect.objectContaining({ name: "member", children: [] })],
      }),
    ]);
    expect(roots.delete).toHaveBeenCalledOnce();
    expect(children.delete).toHaveBeenCalledOnce();
    expect(childChildren.delete).toHaveBeenCalledOnce();
  });

  it("copies nested signature parameters and deletes their handles", () => {
    const parameters = fakeList([
      { label: [3, 7] as [number, number], documentation: { kind: "markdown", value: "parameter" } },
    ]);
    const signatures = fakeList<SlangSignatureInformation>([
      { label: "foo(float x)", documentation: { kind: "markdown", value: "function" }, parameters },
    ]);
    const { server, workspace } = createFixture();
    server.signatureHelp.mockReturnValue({ signatures, activeSignature: 0, activeParameter: 0 });

    expect(workspace.signatureHelp("file:///project/root.slang", { line: 4, character: 2 })).toEqual({
      signatures: [
        {
          label: "foo(float x)",
          documentation: { kind: "markdown", value: "function" },
          parameters: [{ label: [3, 7], documentation: { kind: "markdown", value: "parameter" } }],
        },
      ],
      activeSignature: 0,
      activeParameter: 0,
    });
    expect(signatures.delete).toHaveBeenCalledOnce();
    expect(parameters.delete).toHaveBeenCalledOnce();
  });

  it("copies completion commit characters and diagnostics while deleting their handles", () => {
    const commitCharacters = fakeList(["(", "."]);
    const completions = fakeList([
      {
        label: "paletteColor",
        kind: 3,
        detail: "float3 paletteColor()",
        data: "resolve-data",
        commitCharacters,
      },
    ]);
    const diagnostics = fakeList([
      {
        code: "30001",
        severity: 1,
        message: "bad token",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
    ]);
    const { server, workspace } = createFixture();
    server.completion.mockReturnValue(completions);
    server.getDiagnostics.mockReturnValue(diagnostics);

    expect(workspace.completion("file:///project/root.slang", { line: 0, character: 0 })).toEqual([
      expect.objectContaining({ label: "paletteColor", commitCharacters: ["(", "."] }),
    ]);
    expect(workspace.diagnostics("file:///project/root.slang")).toEqual([
      expect.objectContaining({ code: "30001", severity: 1, message: "bad token" }),
    ]);
    expect(completions.delete).toHaveBeenCalledOnce();
    expect(commitCharacters.delete).toHaveBeenCalledOnce();
    expect(diagnostics.delete).toHaveBeenCalledOnce();
  });

  it("resolves a serializable completion DTO and owns temporary native string lists", () => {
    const resolvedCommitCharacters = fakeList([";"]);
    const { server, stringLists, workspace } = createFixture();
    server.completionResolve.mockImplementation((item) => ({ ...item, detail: "resolved", commitCharacters: resolvedCommitCharacters }));

    expect(
      workspace.completionResolve({
        label: "paletteColor",
        kind: 3,
        detail: "",
        data: "resolve-data",
        commitCharacters: ["(", "."],
      }),
    ).toEqual(expect.objectContaining({ detail: "resolved", commitCharacters: [";"] }));
    expect(server.completionResolve).toHaveBeenCalledWith(
      expect.objectContaining({ commitCharacters: expect.objectContaining({ push_back: expect.any(Function) }) }),
    );
    expect(stringLists).toHaveLength(1);
    expect(stringLists[0].push_back.mock.calls).toEqual([["("], ["."]]);
    expect(stringLists[0].delete).toHaveBeenCalledOnce();
    expect(resolvedCommitCharacters.delete).toHaveBeenCalledOnce();
  });

  it("deletes a temporary completion string list when resolution throws", () => {
    const { server, stringLists, workspace } = createFixture();
    server.completionResolve.mockImplementation(() => {
      throw new Error("resolve failed");
    });

    expect(() =>
      workspace.completionResolve({
        label: "paletteColor",
        kind: 3,
        detail: "",
        data: "resolve-data",
        commitCharacters: ["("],
      }),
    ).toThrow("resolve failed");
    expect(stringLists[0].delete).toHaveBeenCalledOnce();
  });

  it("deletes outer and nested handles when recursive copying throws", () => {
    const brokenChildren = fakeList<SlangDocumentSymbol>([], 0);
    Object.defineProperty(brokenChildren, "size", { value: () => 1 });
    const roots = fakeList<SlangDocumentSymbol>([
      {
        name: "Palette",
        detail: "struct",
        kind: 23,
        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
        selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        children: brokenChildren,
      },
    ]);
    const { server, workspace } = createFixture();
    server.documentSymbol.mockReturnValue(roots);

    expect(() => workspace.documentSymbols("file:///project/root.slang")).toThrow("copy failed");
    expect(roots.delete).toHaveBeenCalledOnce();
    expect(brokenChildren.delete).toHaveBeenCalledOnce();
  });

  it("deletes a result handle when copying throws", () => {
    const broken = fakeList([{ uri: "file:///workspace/root.slang", range: {} }], 0);
    const { server, workspace } = createFixture();
    server.gotoDefinition.mockReturnValue(broken);

    expect(() => workspace.definition("file:///project/root.slang", { line: 0, character: 0 })).toThrow("copy failed");
    expect(broken.delete).toHaveBeenCalledOnce();
  });
});
