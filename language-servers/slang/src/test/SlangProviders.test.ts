import { describe, expect, it } from "vitest";
import type { ShaderAuthoringEnvironment } from "@shader-studio/types";
import { DiagnosticSeverity, SymbolKind } from "vscode-languageserver-protocol";
import { SlangDiagnosticsProvider } from "../providers/SlangDiagnosticsProvider.js";
import { SlangNavigationProvider } from "../providers/SlangNavigationProvider.js";
import { SlangSymbolsProvider } from "../providers/SlangSymbolsProvider.js";
import type { SlangDiagnosticsContext, SlangNavigationContext, SlangProviderState, SlangSymbolsContext } from "../providers/SlangProviderContext.js";
import type { SlangList } from "../slangLanguageServerTypes.js";

const uri = "file:///image.slang";
const document = { uri, languageId: "slang" as const, version: 1, environmentGeneration: 1 };
const environment: ShaderAuthoringEnvironment = {
  documentUri: uri,
  languageId: "slang",
  generation: 1,
  passName: "Image",
  stage: "fragment",
  customUniforms: [],
  resources: [],
  virtualFiles: [],
};

function list<T>(items: readonly T[]): SlangList<T> {
  return { size: () => items.length, get: (index) => items[index] };
}

function state(text: string): SlangProviderState {
  return { document: { uri, languageId: "slang", version: 1, text }, environment, offset: 0 };
}

describe("Slang language-feature providers", () => {
  it("keeps official diagnostics authoritative and appends environment and unused-local advice", async () => {
    const current = state("float unused;");
    const compilerDiagnostics = () => [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "compiler" }];
    const unusedLocalDiagnostics = () => [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } }, message: "unused" }];
    const provider = new SlangDiagnosticsProvider({
      current: () => current,
      diagnostics: () => list([{ code: "official", severity: DiagnosticSeverity.Error, message: "official", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }]),
      compilerDiagnostics,
      unusedLocalDiagnostics,
    } as unknown as SlangDiagnosticsContext);

    const diagnostics = await provider.provide({ document });

    expect(diagnostics.map((item) => item.message)).toEqual(["official", "unused"]);
  });

  it("uses compiler diagnostics only when the language server returned no diagnostics", async () => {
    const current = { ...state("float value;"), environment: { ...environment, resources: [{ name: "iResolution", kind: "texture-2d" as const }] } };
    const provider = new SlangDiagnosticsProvider({
      current: () => current,
      diagnostics: () => list([]),
      compilerDiagnostics: () => [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, message: "compiler" }],
      unusedLocalDiagnostics: () => [],
    } as unknown as SlangDiagnosticsContext);

    expect((await provider.provide({ document })).map((item) => item.message)).toEqual(expect.arrayContaining(["compiler"]));
    const unavailable = new SlangDiagnosticsProvider({ ...({} as SlangDiagnosticsContext), current: () => undefined });
    expect(await unavailable.provide({ document })).toEqual([]);
  });

  it("uses server symbols when available and parses authored declarations as a fallback", async () => {
    const current = state("float helper(float value) { return value; }");
    const provider = new SlangSymbolsProvider({
      current: () => current,
      documentSymbols: () => list([]),
    } as unknown as SlangSymbolsContext);
    expect((await provider.provide({ document })).map((item) => item.name)).toEqual(["helper"]);

    const official = new SlangSymbolsProvider({
      current: () => current,
      documentSymbols: () => list([{ name: "serverSymbol", detail: "", kind: SymbolKind.Function, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, children: list([]) }]),
    } as unknown as SlangSymbolsContext);
    expect((await official.provide({ document })).map((item) => item.name)).toEqual(["serverSymbol"]);

    const unavailable = new SlangSymbolsProvider({ ...({} as SlangSymbolsContext), current: () => undefined });
    expect(await unavailable.provide({ document })).toEqual([]);
  });

  it("preserves cross-file native definitions and falls back to authored declarations", async () => {
    const current = state("float helper(float value) { return value; }\nfloat x = helper(1.0);");
    const externalUri = "file:///common.slang";
    const external = new SlangNavigationProvider({
      current: () => current,
      definition: () => list([{ uri: externalUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } }]),
    } as unknown as SlangNavigationContext);
    expect(await external.definition({ document, position: { line: 1, character: 11 } })).toEqual([{ uri: externalUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } }]);

    const local = new SlangNavigationProvider({
      current: () => current,
      definition: () => list([]),
    } as unknown as SlangNavigationContext);
    expect(await local.definition({ document, position: { line: 1, character: 11 } })).toEqual([{ uri, range: expect.objectContaining({ start: { line: 0, character: 6 } }) }]);
  });

  it("declines navigation outside a current document and uses source signatures when native help is absent", async () => {
    const current = state("float helper(float value) { return value; }\nfloat x = helper(1.0);");
    const provider = new SlangNavigationProvider({
      current: () => current,
      definition: () => list([]),
      signatureHelp: () => undefined,
      renameDocuments: () => [],
      documentText: () => undefined,
      nativeRename: () => null,
      renameCompiles: () => false,
    } as unknown as SlangNavigationContext);
    expect((await provider.signatureHelp({ document, position: { line: 1, character: 20 } }))?.signatures[0]?.label).toContain("helper");

    const unavailable = new SlangNavigationProvider({ ...({} as SlangNavigationContext), current: () => undefined });
    expect(await unavailable.definition({ document, position: { line: 0, character: 0 } })).toEqual([]);
    expect(await unavailable.signatureHelp({ document, position: { line: 0, character: 0 } })).toBeNull();
    expect(await unavailable.references({ document, position: { line: 0, character: 0 }, includeDeclaration: true })).toEqual([]);
    expect(await unavailable.documentHighlights({ document, position: { line: 0, character: 0 } })).toEqual([]);
    expect(await unavailable.rename({ document, position: { line: 0, character: 0 }, newName: "renamed" })).toBeNull();
  });

  it("preserves native signature metadata when the language server supplies it", async () => {
    const current = state("float value;");
    const provider = new SlangNavigationProvider({
      current: () => current,
      signatureHelp: () => ({ signatures: list([{ label: "float f(float)", documentation: { kind: "markdown", value: "docs" }, parameters: list([{ label: [8, 13], documentation: { kind: "markdown", value: "value" } }]) }]), activeSignature: 0, activeParameter: 0 }),
    } as unknown as SlangNavigationContext);
    expect(await provider.signatureHelp({ document, position: { line: 0, character: 3 } })).toEqual(expect.objectContaining({ activeSignature: 0, signatures: [expect.objectContaining({ label: "float f(float)" })] }));
  });

  it("accepts a compiler-validated native rename for generic Slang syntax", async () => {
    const current = state("generic<T> T identity(T value) { return value; }");
    const edit = { changes: { [uri]: [{ range: { start: { line: 0, character: 13 }, end: { line: 0, character: 21 } }, newText: "renamed" }] } };
    const provider = new SlangNavigationProvider({
      current: () => current,
      renameDocuments: () => [],
      documentText: () => current.document.text,
      nativeRename: () => edit,
      renameCompiles: () => true,
    } as unknown as SlangNavigationContext);
    expect(await provider.rename({ document, position: { line: 0, character: 15 }, newName: "renamed" })).toEqual(edit);
  });

  it("does not offer signatures from inside a comment", async () => {
    const current = state("// helper(1.0)");
    const provider = new SlangNavigationProvider({ current: () => current } as unknown as SlangNavigationContext);
    expect(await provider.signatureHelp({ document, position: { line: 0, character: 11 } })).toBeNull();
  });
});
