import {
  CompletionItemKind,
  DiagnosticSeverity,
  DiagnosticTag,
  DocumentHighlightKind,
  MarkupKind,
  SymbolKind,
  type CompletionItem,
  type Diagnostic,
  type DocumentHighlight,
  type DocumentSymbol,
  type Hover,
  type Location,
  type Position,
  type Range,
  type ParameterInformation,
  type SignatureHelp,
  type SignatureInformation,
  type WorkspaceEdit,
} from "vscode-languageserver-protocol";
import {
  DocumentStore,
  VirtualFileSystem,
  findMemberAccess,
  formatLiteralColorComponent,
  isPositionInComment,
  literalColorFromArguments,
  swizzleCompletions,
  memberSelectionAt,
  type ColorPresentationParams,
  type DocumentParams,
  type DocumentPositionParams,
  type LanguageService,
  type ReferenceParams,
  type RenameParams,
  type ServerCapabilities,
  type ShaderDocumentSnapshot,
} from "@shader-studio/language-server-core";
import {
  SHADER_STUDIO_SYMBOL_DOCS,
  buildWgslChannelAuthoringSource,
  isShaderLanguageReservedTerm,
  isValidShaderIdentifier,
  isWgslReservedWord,
  validateShaderAuthoringEnvironment,
  wgslStorageElementType,
  type ShaderAuthoringEnvironment,
} from "@shader-studio/types";
import {
  parseWgslDocument,
  parseWgslDocumentAtPosition,
  positionOffset,
  resolveWgslExpressionType,
  symbolAtPosition,
  tokenizeWgsl,
  visibleSymbolsAtPosition,
  wgslVectorTypeName,
  type WgslAnalysisDocument,
  type WgslInferenceContext,
  type WgslSymbol,
  type WgslToken,
} from "@shader-studio/wgsl-analysis";
import { WGSL_INTRINSICS, findWgslAttribute, findWgslIntrinsics } from "./intrinsics.js";
import { WGSL_VERTEX_HOOK_FEATURES, type WgslVertexHookFeature } from "./vertexHook.js";
import {
  WGSL_MAIN_IMAGE_COORDINATE_DESCRIPTION,
  WGSL_MAIN_IMAGE_DESCRIPTION,
} from "./fragmentHook.js";

const CHANNEL_DECLARATIONS_URI = "shader-studio://generated/channels.wgsl";
import { unusedSymbolDiagnostics, isRenameableName, orderedRanges, symbolAtRenamePosition, identifierPosition, includedReferenceRanges, deduplicateLocations, WGSL_SWIZZLE_SETS, memberCompletions, environmentTypeName, authoringValueWgslType, completionFromDoc, markdownDocumentation, markdownHover, completionKind, documentSymbolKind, vertexHookFeature, WGSL_VEC2_TYPES, WGSL_VEC4_TYPES, mainImageFeature, rangeContains, comparePosition, visibleIntrinsics, wgslStage, wordAt, zeroRange, SERVICE_SOURCE, GENERATED_CHANNEL_DESCRIPTION, generatedWgslFunctions, signatureInformation, functionSignatures, functionSignature, typedName, declarationLabel, declarationDocumentation, isAttributeName, leadingComment, callAt, templateListEnd, WGSL_COLOR_CONSTRUCTOR, findWgslLiteralColors, offsetPosition, rangeKey, errorDiagnostic, WGSL_PREDECLARED_NAMES, knownWgslNames, reservedWordDiagnostics, unresolvedReferenceDiagnostics, FRAGMENT_ONLY_BUILTINS, COMPUTE_ONLY_BUILTINS, stageDiagnostics, functionBodies, restrictedStageUses, includedStageViolations, stageEntryNames, calledNames, tokenRange, samplingStageWarnings, BUILTIN_RESULT_FIELDS, inferenceContext, includedFieldType, expressionContext, includedGlobalType, uniqueIntrinsicReturnType, identifierSite, memberHover } from "./WgslLanguageServiceSupport.js";
import type { WgslMainImageFeature, WgslCallableDescription, WgslLiteralColor, RestrictedStageUse, IncludedStageViolation, IdentifierSite } from "./WgslLanguageServiceSupport.js";

const CAPABILITIES: ServerCapabilities = {
  completion: true,
  hover: true,
  definition: true,
  signatureHelp: true,
  documentSymbols: true,
  // Lightweight syntax, name, and stage errors ahead of the renderer. The
  // renderer compiler stays authoritative: the arbiters drop these errors on
  // any line it reports.
  diagnostics: true,
  documentColors: true,
  references: true,
  documentHighlights: true,
  rename: true,
};

/** Read-only analysis access shared by focused feature providers. */
export interface WgslProviderContext {
  current(params: DocumentParams): WgslDocumentState | undefined;
  includes(uri: string): readonly WgslAnalysisDocument[];
  getAnalyses(): ReadonlyMap<string, WgslAnalysisDocument>;
  getAllIncludes(): ReadonlyMap<string, readonly WgslAnalysisDocument[]>;
}

export interface WgslDocumentState {
  document: ShaderDocumentSnapshot;
  environment: ShaderAuthoringEnvironment;
  analysis: WgslAnalysisDocument;
}

export class WgslLanguageServiceBackend {
  private readonly store = new DocumentStore();
  private readonly files = new VirtualFileSystem();
  private readonly analyses = new Map<string, WgslAnalysisDocument>();
  private readonly includeAnalyses = new Map<string, readonly WgslAnalysisDocument[]>();
  private readonly workspaceUris = new Set<string>();

  async initialize(): Promise<ServerCapabilities> {
    return CAPABILITIES;
  }

  async syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    if (environment.languageId !== "wgsl" || !this.store.syncEnvironment(environment)) {
      return;
    }
    // WGSL has no imports: common concatenation is the only multi-file
    // mechanism, so every context file parses as plain WGSL.
    const contextFiles = environment.commonFile
      ? [environment.commonFile, ...environment.virtualFiles]
      : environment.virtualFiles;
    this.files.replaceEnvironment(contextFiles);
    this.syncWorkspace(environment);
    this.includeAnalyses.set(environment.documentUri, [
      ...contextFiles.map(file => parseWgslDocument(file.uri, file.text, environment.stage)),
      parseWgslDocument(CHANNEL_DECLARATIONS_URI, buildWgslChannelAuthoringSource(
        environment.resources.filter(resource => resource.kind !== 'storage').map((resource, slot) => ({
          name: resource.name, kind: resource.kind as 'texture-2d' | 'texture-cube' | 'texture-3d', slot: resource.slot ?? slot,
        })), environment.stage === 'fragment'), environment.stage),
    ]);
    this.rebuild(environment.documentUri);
  }

  async openDocument(document: ShaderDocumentSnapshot): Promise<void> {
    if (document.languageId !== "wgsl" || !this.store.open(document)) {
      return;
    }
    this.files.openOverlay(document);
    this.rebuild(document.uri);
  }

  async changeDocument(document: ShaderDocumentSnapshot): Promise<void> {
    if (document.languageId !== "wgsl" || !this.store.change(document)) {
      return;
    }
    this.files.openOverlay(document);
    this.rebuild(document.uri);
  }

  async closeDocument(uri: string): Promise<void> {
    this.store.close(uri);
    this.files.closeOverlay(uri);
    this.analyses.delete(uri);
    this.includeAnalyses.delete(uri);
  }

  async documentColors(params: DocumentParams) {
    const state = this.current(params);
    return state ? findWgslLiteralColors(state.document.text).map(({ color, range }) => ({ color, range })) : [];
  }

  /** Rewrites only the arguments, so the constructor keeps its spelling and arity. */
  async colorPresentations(params: ColorPresentationParams) {
    if (!this.store.isCurrent(params.document)) {
      return [];
    }
    const source = this.store.getDocument(params.document.uri)?.text ?? "";
    const target = findWgslLiteralColors(source).find((candidate) => rangeKey(candidate.range) === rangeKey(params.range));
    if (!target) {
      return [];
    }
    const channels = target.components === 3
      ? [params.color.red, params.color.green, params.color.blue]
      : [params.color.red, params.color.green, params.color.blue, params.color.alpha];
    const label = `${target.head}${channels.map(formatLiteralColorComponent).join(", ")})`;
    return [{ label, textEdit: { range: params.range, newText: label } }];
  }

  async dispose(): Promise<void> {
    this.analyses.clear();
    this.includeAnalyses.clear();
  }

  nameIsTaken(
    state: NonNullable<ReturnType<WgslLanguageServiceBackend["current"]>>,
    params: RenameParams,
  ): boolean {
    const { newName } = params;
    return visibleSymbolsAtPosition(state.analysis, params.position).some((item) => item.name === newName)
      || state.environment.customUniforms.some((item) => item.name === newName)
      || state.environment.resources.some((item) => item.name === newName)
      || SHADER_STUDIO_SYMBOL_DOCS.some((item) => item.languages.includes("wgsl") && item.name === newName)
      || visibleIntrinsics(state.environment.stage).some((item) => item.name === newName)
      || (this.includeAnalyses.get(params.document.uri) ?? [])
        .some((analysis) => analysis.symbols.some((item) => item.name === newName));
  }

  includedSymbolAt(state: NonNullable<ReturnType<WgslLanguageServiceBackend["current"]>>, position: Position): { analysis: WgslAnalysisDocument; symbol: WgslSymbol } | undefined {
    const name = wordAt(state.document.text, identifierPosition(state.document.text, position));
    return name === undefined ? undefined : (this.includeAnalyses.get(state.document.uri) ?? [])
      .map((analysis) => ({ analysis, symbol: analysis.symbols.find((candidate) => candidate.name === name) }))
      .find((candidate): candidate is { analysis: WgslAnalysisDocument; symbol: WgslSymbol } => candidate.symbol !== undefined);
  }

  includedReferences(state: NonNullable<ReturnType<WgslLanguageServiceBackend["current"]>>, params: ReferenceParams, includeDeclaration: boolean): Location[] {
    const included = this.includedSymbolAt(state, params.position);
    if (!included) {
      return [];
    }
    const mainRanges = includedReferenceRanges(state.analysis, included.symbol);
    const includedRanges = includeDeclaration ? [included.symbol.declaration, ...included.symbol.references] : included.symbol.references;
    const shared = this.commonUses(included.symbol, included.analysis.uri);
    const locations = [
      ...orderedRanges(includedRanges).map((range) => ({ uri: included.analysis.uri, range })),
      ...orderedRanges(mainRanges).map((range) => ({ uri: params.document.uri, range })),
      ...[...shared].flatMap(([uri, ranges]) => uri === params.document.uri ? [] : orderedRanges(ranges).map((range) => ({ uri, range }))),
    ];
    return deduplicateLocations(locations);
  }

  /** Every open pass parses Common independently, so join their unresolved call sites here. */
  commonUses(symbol: WgslSymbol, ownerUri: string): Map<string, Range[]> {
    const uses = new Map<string, Range[]>();
    for (const [passUri, includes] of this.includeAnalyses) {
      if (!includes.some((analysis) => analysis.uri === ownerUri && analysis.symbols.some((candidate) => candidate.id === symbol.id))) {
        continue;
      }
      const pass = this.analyses.get(passUri);
      if (pass) {
        uses.set(passUri, includedReferenceRanges(pass, symbol));
      }
    }
    return uses;
  }

  commonRenameCollides(uses: ReadonlyMap<string, readonly Range[]>, symbol: WgslSymbol, newName: string): boolean {
    for (const [uri, references] of uses) {
      const analysis = this.analyses.get(uri);
      if (analysis && references.some((reference) => visibleSymbolsAtPosition(analysis, reference.start)
        .some((candidate) => candidate.name === newName && candidate.id !== symbol.id))) {
        return true;
      }
    }
    return false;
  }


  private rebuild(uri: string): void {
    const document = this.store.getDocument(uri);
    const environment = this.store.getEnvironment(uri);
    if (!document || !environment) {
      return;
    }
    this.analyses.set(uri, parseWgslDocument(uri, document.text, environment.stage, inferenceContext(environment, this.includeAnalyses.get(uri) ?? [])));
  }

  private syncWorkspace(environment: ShaderAuthoringEnvironment): void {
    const workspaceDocuments = environment.workspaceDocuments ?? [];
    const nextUris = new Set(workspaceDocuments.map((file) => file.uri));
    for (const uri of this.workspaceUris) {
      if (!nextUris.has(uri)) {
        this.includeAnalyses.delete(uri);
        if (!this.store.getDocument(uri)) {
          this.analyses.delete(uri);
        }
      }
    }
    this.workspaceUris.clear();
    for (const file of workspaceDocuments) {
      this.workspaceUris.add(file.uri);
      const text = this.store.getDocument(file.uri)?.text ?? file.text;
      this.analyses.set(file.uri, parseWgslDocument(file.uri, text, file.stage));
      const common = file.commonUri === undefined ? undefined : workspaceDocuments
        .find((candidate) => candidate.uri === file.commonUri);
      this.includeAnalyses.set(file.uri, common ? [parseWgslDocument(common.uri, common.text, common.stage)] : []);
    }
  }

  current(params: DocumentParams): WgslDocumentState | undefined {
    if (!this.store.isCurrent(params.document)) {
      return undefined;
    }
    const document = this.store.getDocument(params.document.uri);
    const environment = this.store.getEnvironment(params.document.uri);
    const analysis = this.analyses.get(params.document.uri);
    return document && environment && analysis ? { document, environment, analysis } : undefined;
  }

  includes(uri: string): readonly WgslAnalysisDocument[] {
    return this.includeAnalyses.get(uri) ?? [];
  }

  getAnalyses(): ReadonlyMap<string, WgslAnalysisDocument> {
    return this.analyses;
  }
  getAllIncludes(): ReadonlyMap<string, readonly WgslAnalysisDocument[]> {
    return this.includeAnalyses;
  }

}
