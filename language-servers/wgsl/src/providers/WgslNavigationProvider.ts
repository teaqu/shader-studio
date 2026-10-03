import type { DocumentPositionParams, ReferenceParams, RenameParams } from "@shader-studio/language-server-core";
import { DocumentHighlightKind, type DocumentHighlight, type Location, type Range, type SignatureHelp, type WorkspaceEdit } from "vscode-languageserver-protocol";
import { isPositionInComment } from "@shader-studio/language-server-core";
import { parseWgslDocumentAtPosition, symbolAtPosition, visibleSymbolsAtPosition } from "@shader-studio/wgsl-analysis";
import { callAt, functionSignatures, GENERATED_CHANNEL_DESCRIPTION, generatedWgslFunctions, includedReferenceRanges, isRenameableName, orderedRanges, signatureInformation, symbolAtRenamePosition, visibleIntrinsics, wordAt } from "../WgslLanguageServiceSupport.js";
import { SHADER_STUDIO_SYMBOL_DOCS } from "@shader-studio/types";
import { deduplicateLocations, identifierPosition } from "../WgslLanguageServiceSupport.js";
import type { WgslDocumentState, WgslProviderContext } from "../WgslLanguageServiceBackend.js";
import type { WgslAnalysisDocument, WgslSymbol } from "@shader-studio/wgsl-analysis";

export class WgslNavigationProvider {
  constructor(private readonly context: WgslProviderContext) {}
  async definition(params: DocumentPositionParams): Promise<Location[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    const name = wordAt(state.document.text, params.position);
    const symbol = symbolAtPosition(state.analysis, params.position) ?? visibleSymbolsAtPosition(state.analysis, params.position).find((candidate) => candidate.name === name) ?? state.analysis.symbols.find((candidate) => candidate.name === name);
    if (symbol && state.analysis.hostGlobalIds.has(symbol.id)) {
      return [];
    }
    if (symbol) {
      return [{ uri: params.document.uri, range: symbol.declaration }];
    }
    for (const analysis of this.context.includes(params.document.uri)) {
      const included = analysis.symbols.find((candidate) => candidate.name === name && !analysis.hostGlobalIds.has(candidate.id));
      if (included) {
        return analysis.uri === "shader-studio://generated/channels.wgsl" ? [] : [{ uri: analysis.uri, range: included.declaration }];
      }
    }
    return [];
  }
  async signatureHelp(params: DocumentPositionParams): Promise<SignatureHelp | null> {
    const state = this.context.current(params);
    if (!state || isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const call = callAt(state.document.text, params.position);
    if (!call) {
      return null;
    }
    const analysis = state.analysis.parsedSuccessfully ? state.analysis : parseWgslDocumentAtPosition(params.document.uri, state.document.text, state.environment.stage, params.position);
    const includes = this.context.includes(params.document.uri);
    const authored = [...functionSignatures(analysis, call.name, "Declared in this shader."), ...includes.filter((included) => included.uri !== "shader-studio://generated/channels.wgsl").flatMap((included) => functionSignatures(included, call.name, included.uri === state.environment.commonFile?.uri ? "Declared in Shader Studio Common." : "Declared in an included shader file."))];
    const signatures = authored.length ? authored : [...includes.filter((included) => included.uri === "shader-studio://generated/channels.wgsl").flatMap((included) => functionSignatures(included, call.name, GENERATED_CHANNEL_DESCRIPTION)), ...generatedWgslFunctions(state.environment).filter((item) => item.name === call.name).map((item) => signatureInformation(item.name, item.parameters, item.returnType, item.description)), ...visibleIntrinsics(state.environment.stage).filter((item) => item.kind === "function" && item.name === call.name).map((item) => signatureInformation(item.name, item.parameters, item.returnType, item.description))];
    if (!signatures.length) {
      return null;
    }
    return { signatures, activeSignature: Math.max(0, signatures.findIndex((signature) => (signature.parameters?.length ?? 0) > call.parameter)), activeParameter: call.parameter };
  }
  async references(params: ReferenceParams): Promise<Location[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    const symbol = symbolAtPosition(state.analysis, params.position);
    if (!symbol) {
      return this.includedReferences(state, params, params.includeDeclaration);
    }
    const ranges = params.includeDeclaration && !state.analysis.hostGlobalIds.has(symbol.id)
      ? [symbol.declaration, ...symbol.references] : symbol.references;
    const shared = this.commonUses(symbol, params.document.uri);
    return [
      ...orderedRanges(ranges).map((range) => ({ uri: params.document.uri, range })),
      ...[...shared].flatMap(([uri, references]) => orderedRanges(references).map((range) => ({ uri, range }))),
    ];
  }
  async highlights(params: DocumentPositionParams): Promise<DocumentHighlight[]> {
    const state = this.context.current(params);
    if (!state) {
      return [];
    }
    const symbol = symbolAtPosition(state.analysis, params.position);
    if (!symbol) {
      const included = this.includedSymbolAt(state, params.position);
      return included ? orderedRanges(includedReferenceRanges(state.analysis, included.symbol))
        .map((range) => ({ range, kind: DocumentHighlightKind.Read })) : [];
    }
    const declaration = state.analysis.hostGlobalIds.has(symbol.id)
      ? [] : [{ range: symbol.declaration, kind: DocumentHighlightKind.Write }];
    return [...declaration, ...orderedRanges(symbol.references).map((range) => ({ range, kind: DocumentHighlightKind.Read }))];
  }
  async rename(params: RenameParams): Promise<WorkspaceEdit | null> {
    const state = this.context.current(params);
    const symbol = state ? symbolAtRenamePosition(state.analysis, params.position) : null;
    const included = state && !symbol ? this.includedSymbolAt(state, params.position) : undefined;
    const target = symbol ?? included?.symbol;
    const ownerUri = symbol ? params.document.uri : included?.analysis.uri;
    if (!state || !target || !ownerUri || ownerUri === "shader-studio://generated/channels.wgsl"
      || (symbol && state.analysis.hostGlobalIds.has(symbol.id)) || !isRenameableName(params.newName)
      || this.nameIsTaken(state, params)) {
      return null;
    }
    const shared = this.commonUses(target, ownerUri);
    if (this.commonRenameCollides(shared, target, params.newName)) {
      return null;
    }
    const changes: Record<string, { range: Range; newText: string }[]> = {};
    changes[ownerUri] = orderedRanges([target.declaration, ...target.references])
      .map((range) => ({ range, newText: params.newName }));
    for (const [uri, references] of shared) {
      changes[uri] = orderedRanges(references).map((range) => ({ range, newText: params.newName }));
    }
    return { changes };
  }

  private includedSymbolAt(state: WgslDocumentState, position: DocumentPositionParams["position"]): { analysis: WgslAnalysisDocument; symbol: WgslSymbol } | undefined {
    const name = wordAt(state.document.text, identifierPosition(state.document.text, position));
    return name === undefined ? undefined : this.context.includes(state.document.uri).map((analysis) => ({ analysis, symbol: analysis.symbols.find((candidate) => candidate.name === name) })).find((candidate): candidate is { analysis: WgslAnalysisDocument; symbol: WgslSymbol } => candidate.symbol !== undefined);
  }

  private includedReferences(state: WgslDocumentState, params: ReferenceParams, includeDeclaration: boolean): Location[] {
    const included = this.includedSymbolAt(state, params.position);
    if (!included) {
      return [];
    }
    const shared = this.commonUses(included.symbol, included.analysis.uri);
    return deduplicateLocations([...orderedRanges(includeDeclaration ? [included.symbol.declaration, ...included.symbol.references] : included.symbol.references).map((range) => ({ uri: included.analysis.uri, range })), ...orderedRanges(includedReferenceRanges(state.analysis, included.symbol)).map((range) => ({ uri: params.document.uri, range })), ...[...shared].flatMap(([uri, ranges]) => uri === params.document.uri ? [] : orderedRanges(ranges).map((range) => ({ uri, range })))]);
  }

  private commonUses(symbol: WgslSymbol, ownerUri: string): Map<string, Range[]> {
    const uses = new Map<string, Range[]>();
    for (const [passUri, includes] of this.context.getAllIncludes()) {
      if (!includes.some((analysis) => analysis.uri === ownerUri && analysis.symbols.some((candidate) => candidate.id === symbol.id))) {
        continue;
      }
      const pass = this.context.getAnalyses().get(passUri);
      if (pass) {
        uses.set(passUri, includedReferenceRanges(pass, symbol));
      }
    }
    return uses;
  }

  private commonRenameCollides(uses: ReadonlyMap<string, readonly Range[]>, symbol: WgslSymbol, newName: string): boolean {
    return [...uses].some(([uri, references]) => {
      const analysis = this.context.getAnalyses().get(uri); return analysis !== undefined && references.some((reference) => visibleSymbolsAtPosition(analysis, reference.start).some((candidate) => candidate.name === newName && candidate.id !== symbol.id));
    });
  }

  private nameIsTaken(state: WgslDocumentState, params: RenameParams): boolean {
    return visibleSymbolsAtPosition(state.analysis, params.position).some((item) => item.name === params.newName) || state.environment.customUniforms.some((item) => item.name === params.newName) || state.environment.resources.some((item) => item.name === params.newName) || SHADER_STUDIO_SYMBOL_DOCS.some((item) => item.languages.includes("wgsl") && item.name === params.newName) || visibleIntrinsics(state.environment.stage as "fragment" | "vertex" | "compute").some((item) => item.name === params.newName) || this.context.includes(params.document.uri).some((analysis) => analysis.symbols.some((item) => item.name === params.newName));
  }
}
