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
  swizzleSelections,
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

export class WgslLanguageService implements LanguageService {
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

  async completion(params: DocumentPositionParams): Promise<CompletionItem[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    if (isPositionInComment(state.document.text, params.position)) {
      return [];
    }
    const access = findMemberAccess(state.document.text, params.position);
    if (access) {
      return memberCompletions(
        access.expression,
        params.position,
        state.document.text,
        state.environment,
        this.includeAnalyses.get(params.document.uri) ?? [],
        params.document.uri,
      );
    }
    const items = new Map<string, CompletionItem>();
    // Authored declarations shadow environment names of the same spelling.
    const authoredNames = new Set<string>();
    // The statement being completed is rarely valid WGSL, and a failed parse leaves the
    // analysis with no symbols at all, so recover the declarations that precede it.
    const analysis = state.analysis.parsedSuccessfully
      ? state.analysis
      : parseWgslDocumentAtPosition(
        params.document.uri,
        state.document.text,
        state.environment.stage,
        params.position,
        inferenceContext(state.environment, this.includeAnalyses.get(params.document.uri) ?? []),
      );
    for (const symbol of visibleSymbolsAtPosition(analysis, params.position)) {
      const vertexHook = state.environment.stage === "vertex" ? vertexHookFeature(analysis, symbol) : undefined;
      const fragmentHook = state.environment.stage === "fragment" ? mainImageFeature(analysis, symbol) : undefined;
      const hook = vertexHook ?? fragmentHook;
      items.set(symbol.name, {
        label: symbol.name,
        kind: completionKind(symbol),
        detail: hook?.signature ?? symbol.signature ?? symbol.typeName,
        documentation: hook ? markdownDocumentation(hook.description) : undefined,
      });
      if (!analysis.hostGlobalIds.has(symbol.id)) {
        authoredNames.add(symbol.name);
      }
    }
    for (const analysis of this.includeAnalyses.get(params.document.uri) ?? []) {
      for (const symbol of analysis.symbols) {
        if (analysis.uri === CHANNEL_DECLARATIONS_URI && (symbol.name.startsWith('_ss') || !analysis.scopes.some(scope => scope.id === symbol.scopeId && scope.kind === 'global'))) {
          continue;
        }
        if (items.has(symbol.name)) {
          continue;
        }
        items.set(symbol.name, { label: symbol.name, kind: completionKind(symbol), detail: symbol.signature ?? symbol.typeName });
      }
    }
    if (state.environment.stage === "vertex") {
      const hook = WGSL_VERTEX_HOOK_FEATURES[0];
      if (hook && !items.has(hook.name)) {
        items.set(hook.name, {
          label: hook.name,
          kind: CompletionItemKind.Function,
          detail: hook.signature,
          documentation: markdownDocumentation(hook.description),
        });
      }
    }
    for (const generated of generatedWgslFunctions(state.environment)) {
      if (!items.has(generated.name)) {
        items.set(generated.name, {
          label: generated.name,
          kind: CompletionItemKind.Function,
          detail: signatureInformation(generated.name, generated.parameters, generated.returnType).label,
          documentation: markdownDocumentation(generated.description),
        });
      }
    }
    for (const intrinsic of visibleIntrinsics(state.environment.stage)) {
      const key = `${intrinsic.name}:${intrinsic.signature}`;
      items.set(key, {
        label: intrinsic.name,
        kind: intrinsic.kind === "function" ? CompletionItemKind.Function : CompletionItemKind.Variable,
        detail: intrinsic.signature,
        documentation: { kind: MarkupKind.Markdown, value: intrinsic.description },
      });
    }
    for (const doc of SHADER_STUDIO_SYMBOL_DOCS) {
      if (doc.name === "iChannelN" || authoredNames.has(doc.name) || !doc.languages.includes("wgsl") || (doc.stages && !doc.stages.includes(state.environment.stage))) {
        continue;
      }
      items.set(doc.name, completionFromDoc(doc.name, doc.wgslType, doc.description));
    }
    for (const uniform of state.environment.customUniforms) {
      if (authoredNames.has(uniform.name)) {
        continue;
      }
      items.set(uniform.name, completionFromDoc(uniform.name, authoringValueWgslType(uniform.type), "Shader Studio custom uniform."));
    }
    for (const resource of state.environment.resources) {
      if (!items.has(resource.name)) {
        items.set(resource.name, completionFromDoc(resource.name, resource.kind, "Shader Studio shader resource."));
      }
    }
    return [...items.values()];
  }

  async hover(params: DocumentPositionParams): Promise<Hover | null> {
    const state = this.current(params);
    if (!state) {
      return null;
    }
    if (isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const word = wordAt(state.document.text, params.position);
    if (!word) {
      return null;
    }
    if (isAttributeName(state.document.text, params.position)) {
      const attribute = findWgslAttribute(word);
      return attribute ? markdownHover(attribute.signature, attribute.description) : null;
    }
    const site = identifierSite(state.document.text, params.position);
    if (site?.kind === "attribute-argument") {
      // Attribute arguments name builtin values, never authored symbols.
      const builtin = findWgslIntrinsics(word).find((item) => item.kind === "variable");
      return builtin ? markdownHover(builtin.signature, builtin.description) : null;
    }
    if (site?.kind === "member") {
      return memberHover(site, state.document.text, params.document.uri, state.environment, this.includeAnalyses.get(params.document.uri) ?? []);
    }
    // Host globals are synthetic declarations of Shader Studio builtins; they
    // fall through to the builtin documentation below.
    const resolved = symbolAtPosition(state.analysis, params.position)
      ?? visibleSymbolsAtPosition(state.analysis, params.position).find((symbol) => symbol.name === word)
      ?? state.analysis.symbols.find((symbol) => symbol.name === word);
    const userSymbol = resolved && !state.analysis.hostGlobalIds.has(resolved.id) ? resolved : undefined;
    if (userSymbol) {
      const vertexHook = state.environment.stage === "vertex" ? vertexHookFeature(state.analysis, userSymbol) : undefined;
      if (vertexHook) {
        return markdownHover(vertexHook.signature, vertexHook.description);
      }
      const fragmentHook = state.environment.stage === "fragment" ? mainImageFeature(state.analysis, userSymbol) : undefined;
      if (fragmentHook) {
        return markdownHover(fragmentHook.signature, fragmentHook.description);
      }
      return markdownHover(declarationLabel(state.analysis, userSymbol), declarationDocumentation(state.analysis, userSymbol, "Declared in this shader."));
    }
    for (const analysis of this.includeAnalyses.get(params.document.uri) ?? []) {
      const included = analysis.symbols.find((symbol) => symbol.name === word && !analysis.hostGlobalIds.has(symbol.id));
      if (included) {
        const description = analysis.uri === state.environment.commonFile?.uri
          ? "Declared in Shader Studio Common."
          : "Declared in an included shader file.";
        return markdownHover(declarationLabel(analysis, included), declarationDocumentation(analysis, included, description));
      }
    }
    const doc = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === word && item.languages.includes("wgsl"));
    if (doc) {
      // Built-ins are injected as private globals.
      return markdownHover(`var<private> ${typedName(doc.name, doc.wgslType)}`, doc.description);
    }
    const uniform = state.environment.customUniforms.find((item) => item.name === word);
    if (uniform) {
      return markdownHover(`var<private> ${typedName(uniform.name, authoringValueWgslType(uniform.type))}`, "Shader Studio custom uniform.");
    }
    const resource = state.environment.resources.find((item) => item.name === word);
    if (resource) {
      return markdownHover(`${resource.kind} ${resource.name}`, "Shader Studio shader resource.");
    }
    const generated = generatedWgslFunctions(state.environment).find((item) => item.name === word);
    if (generated) {
      return markdownHover(signatureInformation(generated.name, generated.parameters, generated.returnType).label, generated.description);
    }
    const intrinsic = findWgslIntrinsics(word).filter((item) => item.stages.includes(wgslStage(state.environment.stage)))[0];
    return intrinsic ? markdownHover(intrinsic.signature, intrinsic.description) : null;
  }

  async definition(params: DocumentPositionParams): Promise<Location[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const name = wordAt(state.document.text, params.position);
    const symbol = symbolAtPosition(state.analysis, params.position)
      ?? visibleSymbolsAtPosition(state.analysis, params.position).find((candidate) => candidate.name === name)
      ?? state.analysis.symbols.find((candidate) => candidate.name === name);
    if (symbol && state.analysis.hostGlobalIds.has(symbol.id)) {
      return [];
    }
    if (symbol) {
      return [{ uri: params.document.uri, range: symbol.declaration }];
    }
    for (const analysis of this.includeAnalyses.get(params.document.uri) ?? []) {
      const included = analysis.symbols.find((candidate) => candidate.name === name && !analysis.hostGlobalIds.has(candidate.id));
      if (included) {
        return analysis.uri === CHANNEL_DECLARATIONS_URI ? [] : [{ uri: analysis.uri, range: included.declaration }];
      }
    }
    return [];
  }

  async signatureHelp(params: DocumentPositionParams): Promise<SignatureHelp | null> {
    const state = this.current(params);
    if (!state || isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const call = callAt(state.document.text, params.position);
    if (!call) {
      return null;
    }
    // An unfinished call rarely parses: recover the declarations around it.
    const analysis = state.analysis.parsedSuccessfully
      ? state.analysis
      : parseWgslDocumentAtPosition(params.document.uri, state.document.text, state.environment.stage, params.position);
    const includes = this.includeAnalyses.get(params.document.uri) ?? [];
    // Authored functions shadow generated helpers and builtins of the same name.
    const authored = [
      ...functionSignatures(analysis, call.name, "Declared in this shader."),
      ...includes.filter((included) => included.uri !== CHANNEL_DECLARATIONS_URI).flatMap((included) => functionSignatures(
        included,
        call.name,
        included.uri === state.environment.commonFile?.uri ? "Declared in Shader Studio Common." : "Declared in an included shader file.",
      )),
    ];
    const signatures = authored.length > 0 ? authored : [
      ...includes.filter((included) => included.uri === CHANNEL_DECLARATIONS_URI)
        .flatMap((included) => functionSignatures(included, call.name, GENERATED_CHANNEL_DESCRIPTION)),
      ...generatedWgslFunctions(state.environment).filter((item) => item.name === call.name)
        .map((item) => signatureInformation(item.name, item.parameters, item.returnType, item.description)),
      ...visibleIntrinsics(state.environment.stage).filter((item) => item.kind === "function" && item.name === call.name)
        .map((item) => signatureInformation(item.name, item.parameters, item.returnType, item.description)),
    ];
    if (signatures.length === 0) {
      return null;
    }
    // Without type resolution, arity is the only reliable overload signal.
    const fitting = signatures.findIndex((signature) => (signature.parameters?.length ?? 0) > call.parameter);
    return { signatures, activeSignature: Math.max(0, fitting), activeParameter: call.parameter };
  }

  async documentSymbols(params: DocumentParams): Promise<DocumentSymbol[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const globalScopeIds = new Set(
      state.analysis.scopes.filter((scope) => scope.kind === "global").map((scope) => scope.id),
    );
    return state.analysis.symbols
      .filter((symbol) => !state.analysis.hostGlobalIds.has(symbol.id))
      .filter((symbol) => globalScopeIds.has(symbol.scopeId) || symbol.kind === "function" || symbol.kind === "type")
      .map((symbol) => ({
        name: symbol.name,
        detail: symbol.signature ?? symbol.typeName,
        kind: documentSymbolKind(symbol),
        range: symbol.definition,
        selectionRange: symbol.declaration,
      }));
  }

  async references(params: ReferenceParams): Promise<Location[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const symbol = symbolAtPosition(state.analysis, params.position);
    if (!symbol) {
      return this.includedReferences(state, params, params.includeDeclaration);
    }
    const synthetic = state.analysis.hostGlobalIds.has(symbol.id);
    const ranges = params.includeDeclaration && !synthetic
      ? [symbol.declaration, ...symbol.references]
      : symbol.references;
    const shared = this.commonUses(symbol, params.document.uri);
    return [
      ...orderedRanges(ranges).map((range) => ({ uri: params.document.uri, range })),
      ...[...shared].flatMap(([uri, references]) => orderedRanges(references).map((range) => ({ uri, range }))),
    ];
  }

  async documentHighlights(params: DocumentPositionParams): Promise<DocumentHighlight[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const symbol = symbolAtPosition(state.analysis, params.position);
    if (!symbol) {
      const included = this.includedSymbolAt(state, params.position);
      return included ? orderedRanges(includedReferenceRanges(state.analysis, included.symbol))
        .map((range) => ({ range, kind: DocumentHighlightKind.Read })) : [];
    }
    // Synthetic host globals have no source declaration to mark as a write.
    const declaration = state.analysis.hostGlobalIds.has(symbol.id)
      ? []
      : [{ range: symbol.declaration, kind: DocumentHighlightKind.Write }];
    return [
      ...declaration,
      ...orderedRanges(symbol.references).map((range) => ({ range, kind: DocumentHighlightKind.Read })),
    ];
  }

  async rename(params: RenameParams): Promise<WorkspaceEdit | null> {
    const state = this.current(params);
    const symbol = state ? symbolAtRenamePosition(state.analysis, params.position) : null;
    // Synthetic host globals (iTime, ...) resolve so hovers and completion
    // see them, but they have no source declaration to rename.
    const included = state && !symbol ? this.includedSymbolAt(state, params.position) : undefined;
    const target = symbol ?? included?.symbol;
    const ownerUri = symbol ? params.document.uri : included?.analysis.uri;
    if (!state || !target || !ownerUri || ownerUri === CHANNEL_DECLARATIONS_URI || (symbol && state.analysis.hostGlobalIds.has(symbol.id))
      || !isRenameableName(params.newName) || this.nameIsTaken(state, params)) {
      return null;
    }
    const shared = this.commonUses(target, ownerUri);
    if (this.commonRenameCollides(shared, target, params.newName)) {
      return null;
    }
    if (!symbol) {
      const changes: Record<string, { range: Range; newText: string }[]> = {
        [ownerUri]: orderedRanges([target.declaration, ...target.references]).map((range) => ({ range, newText: params.newName })),
      };
      for (const [uri, references] of shared) {
        changes[uri] = orderedRanges(references).map((range) => ({ range, newText: params.newName }));
      }
      return { changes };
    }
    const edits = orderedRanges([symbol.declaration, ...symbol.references])
      .map((range) => ({ range, newText: params.newName }));
    const changes: Record<string, { range: Range; newText: string }[]> = { [params.document.uri]: edits };
    for (const [uri, references] of this.commonUses(symbol, params.document.uri)) {
      changes[uri] = orderedRanges(references).map((range) => ({ range, newText: params.newName }));
    }
    return { changes };
  }

  /**
   * Lightweight checks ahead of the renderer: the first syntax error, names
   * nothing declares, and stage-restricted builtins reachable from an entry,
   * plus hints and warnings the compiler cannot see. The renderer compiler
   * stays authoritative; the arbiters drop these errors on any line it
   * reports. Name and stage errors wait for a clean parse, because recovery
   * can skip the declarations a reference depends on.
   */
  async diagnostics(params: DocumentParams): Promise<Diagnostic[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const includes = this.includeAnalyses.get(params.document.uri) ?? [];
    const samplingWarnings = samplingStageWarnings(state.analysis, state.environment, includes);
    const diagnostics: Diagnostic[] = [];
    const [syntax] = state.analysis.diagnostics;
    if (syntax) {
      diagnostics.push(errorDiagnostic(syntax.range, "syntax", syntax.message));
    } else {
      // The sampling warning already explains a helper the stage does not generate.
      const warned = new Set(samplingWarnings.map((warning) => rangeKey(warning.range)));
      // Common is prepended to every pass, and each pass supplies its own
      // channel helpers, so a name Common uses may exist only in its passes.
      const names = state.environment.passName.toLowerCase() === "common"
        ? []
        : unresolvedReferenceDiagnostics(state.analysis, state.environment, includes);
      diagnostics.push(...[
        ...reservedWordDiagnostics(state.analysis),
        ...names.filter((diagnostic) => !warned.has(rangeKey(diagnostic.range))),
        ...stageDiagnostics(state.analysis, state.environment, includes.filter((included) => included.uri !== CHANNEL_DECLARATIONS_URI)),
      ].sort((left, right) => comparePosition(left.range.start, right.range.start)));
    }
    diagnostics.push(...unusedSymbolDiagnostics(state.analysis), ...samplingWarnings);
    diagnostics.push(...validateShaderAuthoringEnvironment(state.environment).map((issue) => ({
      range: zeroRange(),
      severity: DiagnosticSeverity.Warning,
      source: SERVICE_SOURCE,
      code: issue.code,
      message: issue.message,
    })));
    return diagnostics;
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

  private nameIsTaken(
    state: NonNullable<ReturnType<WgslLanguageService["current"]>>,
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

  private includedSymbolAt(state: NonNullable<ReturnType<WgslLanguageService["current"]>>, position: Position): { analysis: WgslAnalysisDocument; symbol: WgslSymbol } | undefined {
    const name = wordAt(state.document.text, identifierPosition(state.document.text, position));
    return name === undefined ? undefined : (this.includeAnalyses.get(state.document.uri) ?? [])
      .map((analysis) => ({ analysis, symbol: analysis.symbols.find((candidate) => candidate.name === name) }))
      .find((candidate): candidate is { analysis: WgslAnalysisDocument; symbol: WgslSymbol } => candidate.symbol !== undefined);
  }

  private includedReferences(state: NonNullable<ReturnType<WgslLanguageService["current"]>>, params: ReferenceParams, includeDeclaration: boolean): Location[] {
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
  private commonUses(symbol: WgslSymbol, ownerUri: string): Map<string, Range[]> {
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

  private commonRenameCollides(uses: ReadonlyMap<string, readonly Range[]>, symbol: WgslSymbol, newName: string): boolean {
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

  private current(params: DocumentParams) {
    if (!this.store.isCurrent(params.document)) {
      return undefined;
    }
    const document = this.store.getDocument(params.document.uri);
    const environment = this.store.getEnvironment(params.document.uri);
    const analysis = this.analyses.get(params.document.uri);
    return document && environment && analysis ? { document, environment, analysis } : undefined;
  }
}

/**
 * Warns about local variables and parameters nothing reads. Globals stay
 * quiet because uniforms and shared helpers are often set or used outside the
 * document, and functions are entry points or API surface rather than dead
 * locals. Assignments count as references in the analysis, so a variable the
 * body writes to is considered used.
 */
function unusedSymbolDiagnostics(analysis: WgslAnalysisDocument): Diagnostic[] {
  const scopesById = new Map(analysis.scopes.map((scope) => [scope.id, scope]));
  return analysis.symbols.flatMap((symbol) => {
    if ((symbol.kind !== "variable" && symbol.kind !== "parameter") || symbol.references.length > 0) {
      return [];
    }
    if ((scopesById.get(symbol.scopeId)?.kind ?? "global") === "global") {
      return [];
    }
    const label = symbol.kind === "parameter" ? "parameter" : "variable";
    return [{
      range: symbol.declaration,
      // Hint, not Warning: the Unnecessary tag already greys the symbol, and
      // an unused local needs no squiggle.
      severity: DiagnosticSeverity.Hint,
      source: "shader-studio-wgsl-ls",
      code: `unused-${label}`,
      message: `Unused ${label} '${symbol.name}'.`,
      tags: [DiagnosticTag.Unnecessary],
    }];
  });
}

function isRenameableName(name: string): boolean {
  return isValidShaderIdentifier(name) && !isShaderLanguageReservedTerm("wgsl", name);
}

/** Sorts ranges by position and drops duplicates so edits never overlap. */
function orderedRanges(ranges: readonly Range[]): Range[] {
  const unique = new Map<string, Range>();
  for (const range of ranges) {
    unique.set(
      `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`,
      range,
    );
  }
  return [...unique.values()].sort((left, right) => comparePosition(left.start, right.start));
}

/** VS Code places a word selection's active cursor just after the identifier. */
function symbolAtRenamePosition(document: WgslAnalysisDocument, position: Position): WgslSymbol | null {
  return symbolAtPosition(document, position) ?? symbolAtPosition(document, identifierPosition(document.source, position));
}

function identifierPosition(source: string, position: Position): Position {
  const line = source.split("\n")[position.line];
  return position.character > 0 && line?.[position.character - 1] !== undefined
    && /[A-Za-z0-9_]/.test(line[position.character - 1]!)
    ? { line: position.line, character: position.character - 1 }
    : position;
}

function includedReferenceRanges(analysis: WgslAnalysisDocument, symbol: WgslSymbol): Range[] {
  const unresolved = analysis.unresolvedReferences.filter((reference) => reference.name === symbol.name).flatMap((reference) => reference.ranges);
  if (unresolved.length > 0 || symbol.kind !== "function") {
    return unresolved;
  }
  const tokens = tokenizeWgsl(analysis.source);
  return tokens.flatMap((token, index) => token.text === symbol.name && tokens[index + 1]?.text === "("
    ? [{ start: { line: token.line, character: token.character }, end: { line: token.line, character: token.character + token.text.length } }]
    : []);
}

function deduplicateLocations(locations: Location[]): Location[] {
  const unique = new Map<string, Location>();
  for (const location of locations) {
    const { start, end } = location.range;
    unique.set(`${location.uri}:${start.line}:${start.character}:${end.line}:${end.character}`, location);
  }
  return [...unique.values()];
}

/** WGSL swizzle components come in two interchangeable sets. */
const WGSL_SWIZZLE_SETS = ["xyzw", "rgba"] as const;

/**
 * Completions for a member selection such as `uv.`, listing the members of the selected
 * expression only. Expressions whose type cannot be resolved offer nothing, so a selector
 * never falls back to every symbol in scope.
 */
function memberCompletions(
  expression: string,
  position: Position,
  source: string,
  environment: ShaderAuthoringEnvironment,
  includes: readonly WgslAnalysisDocument[],
  uri: string,
): CompletionItem[] {
  const resolved = resolveWgslExpressionType(
    { uri, source, stage: environment.stage, position, expression },
    { includes, ...expressionContext(environment, includes) },
  );
  if (!resolved) {
    return [];
  }
  const resultFields = BUILTIN_RESULT_FIELDS[resolved.name];
  if (resultFields) {
    return resultFields.map((field) => ({
      label: field.name,
      kind: CompletionItemKind.Field,
      detail: field.type,
      documentation: markdownDocumentation(field.description),
    }));
  }
  const vector = resolved.vector;
  if (vector) {
    return swizzleSelections(vector.size, WGSL_SWIZZLE_SETS).map((selection) => ({
      label: selection,
      kind: CompletionItemKind.Field,
      detail: selection.length === 1 ? vector.componentType : wgslVectorTypeName(vector.componentType, selection.length),
      documentation: markdownDocumentation(`Component selection on \`${resolved.name}\`.`),
    }));
  }
  return (resolved.fields ?? []).map((field) => ({
    label: field.name,
    kind: CompletionItemKind.Field,
    detail: field.type,
    documentation: markdownDocumentation(`Field of \`${resolved.name}\`.`),
  }));
}

/** Type of a name the document never declares, such as a uniform supplied by Shader Studio. */
function environmentTypeName(
  name: string,
  environment: ShaderAuthoringEnvironment,
): string | undefined {
  const uniform = environment.customUniforms.find((item) => item.name === name);
  if (uniform) {
    return authoringValueWgslType(uniform.type);
  }
  const storage = environment.resources.find((item) => item.kind === "storage" && item.name === name);
  if (storage?.elementType) {
    return `array<${wgslStorageElementType(storage.elementType, environment.stage === "compute" ? "compute" : "render")}>`;
  }
  const documented = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === name
    && item.languages.includes("wgsl")
    && (!item.stages || item.stages.includes(environment.stage)));
  return documented ? documented.wgslType : undefined;
}

function authoringValueWgslType(type: string): string {
  switch (type) {
    case "float": return "f32";
    case "vec2": return "vec2f";
    case "vec3": return "vec3f";
    case "vec4": return "vec4f";
    default: return "bool";
  }
}

function completionFromDoc(name: string, detail: string | undefined, description: string): CompletionItem {
  return { label: name, kind: CompletionItemKind.Variable, detail, documentation: markdownDocumentation(description) };
}

function markdownDocumentation(description: string) {
  return { kind: MarkupKind.Markdown, value: description } as const;
}

function markdownHover(signature: string, description: string): Hover {
  return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`wgsl\n${signature}\n\`\`\`\n\n${description}` } };
}

function completionKind(symbol: WgslSymbol): CompletionItemKind {
  return symbol.kind === "function" ? CompletionItemKind.Function
    : symbol.kind === "type" ? CompletionItemKind.Struct
      : symbol.kind === "field" ? CompletionItemKind.Field
        : CompletionItemKind.Variable;
}

function documentSymbolKind(symbol: WgslSymbol): SymbolKind {
  return symbol.kind === "function" ? SymbolKind.Function
    : symbol.kind === "type" ? SymbolKind.Struct
      : symbol.kind === "field" ? SymbolKind.Field
        : SymbolKind.Variable;
}

function vertexHookFeature(analysis: WgslAnalysisDocument, symbol: WgslSymbol): WgslVertexHookFeature | undefined {
  const scope = symbol.kind === "function"
    ? analysis.scopes.find((item) => (
      item.kind === "function"
      && item.name === "mainVertex"
      && rangeContains(item.range, symbol.definition)
    ))
    : analysis.scopes.find((item) => item.id === symbol.scopeId && item.kind === "function" && item.name === "mainVertex");
  if (!scope) {
    return undefined;
  }
  const parameters = scope.symbolIds
    .map((id) => analysis.symbols.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is WgslSymbol => candidate?.kind === "parameter");
  const functionSymbol = analysis.symbols.find((candidate) => (
    candidate.kind === "function"
    && candidate.name === "mainVertex"
    && parameters.length === 3
    && parameters.every((parameter) => parameter.typeName?.startsWith("ptr<function,") ?? false)
    && rangeContains(scope.range, candidate.definition)
  ));
  const functionFeature = WGSL_VERTEX_HOOK_FEATURES[0];
  if (!functionSymbol || !functionFeature) {
    return undefined;
  }
  if (symbol.id === functionSymbol.id) {
    return {
      ...functionFeature,
      signature: `fn mainVertex(${parameters.map((parameter) => `${parameter.name}: ${parameter.typeName}`).join(", ")})`,
    };
  }
  const parameterIndex = parameters.findIndex((parameter) => parameter.id === symbol.id);
  const role = WGSL_VERTEX_HOOK_FEATURES[parameterIndex + 1];
  const parameter = parameters[parameterIndex];
  return role && parameter
    ? { ...role, name: parameter.name, signature: `${parameter.name}: ${parameter.typeName}` }
    : undefined;
}

interface WgslMainImageFeature {
  readonly signature: string;
  readonly description: string;
}

const WGSL_VEC2_TYPES = new Set(["vec2f", "vec2<f32>"]);
const WGSL_VEC4_TYPES = new Set(["vec4f", "vec4<f32>"]);

function mainImageFeature(analysis: WgslAnalysisDocument, symbol: WgslSymbol): WgslMainImageFeature | undefined {
  const scope = symbol.kind === "function"
    ? analysis.scopes.find((item) => (
      item.kind === "function"
      && item.name === "mainImage"
      && rangeContains(item.range, symbol.definition)
    ))
    : analysis.scopes.find((item) => item.id === symbol.scopeId && item.kind === "function" && item.name === "mainImage");
  if (!scope) {
    return undefined;
  }
  const parameters = scope.symbolIds
    .map((id) => analysis.symbols.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is WgslSymbol => candidate?.kind === "parameter");
  const [coordinate] = parameters;
  const functionSymbol = analysis.symbols.find((candidate) => (
    candidate.kind === "function"
    && candidate.name === "mainImage"
    && parameters.length === 1
    && coordinate?.typeName !== undefined && WGSL_VEC2_TYPES.has(coordinate.typeName)
    && candidate.typeName !== undefined && WGSL_VEC4_TYPES.has(candidate.typeName)
    && rangeContains(scope.range, candidate.definition)
  ));
  if (!functionSymbol || !coordinate) {
    return undefined;
  }
  if (symbol.id === functionSymbol.id) {
    return {
      signature: `fn mainImage(${coordinate.name}: ${coordinate.typeName}) -> ${functionSymbol.typeName}`,
      description: WGSL_MAIN_IMAGE_DESCRIPTION,
    };
  }
  return symbol.id === coordinate.id
    ? { signature: `${coordinate.name}: ${coordinate.typeName}`, description: WGSL_MAIN_IMAGE_COORDINATE_DESCRIPTION }
    : undefined;
}

function rangeContains(outer: Range, inner: Range): boolean {
  return comparePosition(outer.start, inner.start) <= 0 && comparePosition(outer.end, inner.end) >= 0;
}

function comparePosition(left: Position, right: Position): number {
  return left.line === right.line ? left.character - right.character : left.line - right.line;
}

function visibleIntrinsics(stage: ShaderAuthoringEnvironment["stage"]) {
  const wgsl = wgslStage(stage);
  return WGSL_INTRINSICS.filter((item) => item.stages.includes(wgsl));
}

function wgslStage(stage: ShaderAuthoringEnvironment["stage"]): "fragment" | "vertex" | "compute" {
  return stage === "vertex" ? "vertex" : stage === "compute" ? "compute" : "fragment";
}

function wordAt(source: string, position: Position): string | undefined {
  const line = source.split("\n")[position.line];
  if (line === undefined || position.character < 0 || position.character > line.length) {
    return undefined;
  }
  const left = line.slice(0, position.character).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  const right = line.slice(position.character).match(/^[A-Za-z0-9_]*/)?.[0] ?? "";
  return `${left}${right}` || undefined;
}

function zeroRange() {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

const SERVICE_SOURCE = "shader-studio-wgsl-ls";
const GENERATED_CHANNEL_DESCRIPTION = "Generated by Shader Studio for the configured channels.";

interface WgslCallableDescription {
  readonly name: string;
  readonly parameters: readonly { readonly name: string; readonly type: string }[];
  readonly returnType?: string;
  readonly description: string;
}

/** Prelude functions the renderer injects for this stage outside any parsed source. */
function generatedWgslFunctions(environment: ShaderAuthoringEnvironment): WgslCallableDescription[] {
  if (environment.stage !== "compute") {
    return [];
  }
  const layered = environment.outputLayers !== undefined && environment.outputLayers > 1;
  return [{
    name: "writeOutput",
    parameters: [
      { name: "coord", type: "vec2u" },
      ...(layered ? [{ name: "layer", type: "u32" }] : []),
      { name: "color", type: "vec4f" },
    ],
    description: layered
      ? "Writes a color to one layer of the current compute pass output texture."
      : "Writes a color to the current compute pass output texture.",
  }];
}

function signatureInformation(
  name: string,
  parameters: readonly { readonly name: string; readonly type: string }[],
  returnType: string | undefined,
  documentation?: string,
): SignatureInformation {
  let label = `fn ${name}(`;
  const information: ParameterInformation[] = [];
  parameters.forEach((parameter, index) => {
    if (index > 0) {
      label += ", ";
    }
    const text = `${parameter.name}: ${parameter.type}`;
    // Offsets rather than text: two parameters may print identically.
    information.push({ label: [label.length, label.length + text.length] });
    label += text;
  });
  label += ")";
  if (returnType !== undefined && returnType !== "void") {
    label += ` -> ${returnType}`;
  }
  return {
    label,
    parameters: information,
    ...(documentation ? { documentation: markdownDocumentation(documentation) } : {}),
  };
}

function functionSignatures(analysis: WgslAnalysisDocument, name: string, provenance: string): SignatureInformation[] {
  return analysis.symbols
    .filter((symbol) => symbol.kind === "function" && symbol.name === name)
    .map((symbol) => functionSignature(analysis, symbol, declarationDocumentation(analysis, symbol, provenance)));
}

function functionSignature(analysis: WgslAnalysisDocument, symbol: WgslSymbol, documentation?: string): SignatureInformation {
  const scope = analysis.scopes.find((item) => item.kind === "function" && item.name === symbol.name && rangeContains(item.range, symbol.definition));
  const parameters = (scope?.symbolIds ?? [])
    .map((id) => analysis.symbols.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is WgslSymbol => candidate?.kind === "parameter")
    .map((parameter) => ({ name: parameter.name, type: parameter.typeName ?? "unknown" }));
  return signatureInformation(symbol.name, parameters, symbol.typeName, documentation);
}

/** `name: type`, or the bare name when the type is unknown. */
function typedName(name: string, typeName: string | undefined): string {
  return typeName === undefined ? name : `${name}: ${typeName}`;
}

/** An authored declaration as WGSL spells it: `let uv: vec2f`, `fn f(x: f32) -> f32`, `struct S`. */
function declarationLabel(analysis: WgslAnalysisDocument, symbol: WgslSymbol): string {
  switch (symbol.kind) {
    case "function":
      return functionSignature(analysis, symbol).label;
    case "parameter":
    case "field":
      return typedName(symbol.name, symbol.typeName);
    case "type":
      if (symbol.declarationKeyword !== "alias") {
        return `struct ${symbol.name}`;
      }
      return symbol.typeName === undefined ? `alias ${symbol.name}` : `alias ${symbol.name} = ${symbol.typeName}`;
    default:
      return `${symbol.declarationKeyword ?? (symbol.kind === "constant" ? "const" : "let")} ${typedName(symbol.name, symbol.typeName)}`;
  }
}

/** A declaration's leading `//` comment, when it has one, above where it came from. */
function declarationDocumentation(analysis: WgslAnalysisDocument, symbol: WgslSymbol, provenance: string): string {
  const comment = leadingComment(analysis.source, symbol.declaration.start.line);
  return [comment, provenance].filter(Boolean).join("\n\n");
}

/** Whether the identifier under the cursor names an attribute: `@` sits right before it. */
function isAttributeName(source: string, position: Position): boolean {
  const line = source.split("\n")[position.line] ?? "";
  const start = position.character - (line.slice(0, position.character).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0].length ?? 0);
  return /@\s*$/.test(line.slice(0, start));
}

/** Contiguous `//` lines directly above a declaration, skipping its attribute lines. */
function leadingComment(source: string, declarationLine: number): string | undefined {
  const lines = source.split("\n");
  let line = declarationLine - 1;
  while (line >= 0 && /^\s*@/.test(lines[line] ?? "")) {
    line -= 1;
  }
  const comments: string[] = [];
  for (; line >= 0; line--) {
    const match = /^\s*\/\/+\s?(.*)$/.exec(lines[line] ?? "");
    if (!match) {
      break;
    }
    comments.unshift(match[1]!.trimEnd());
  }
  return comments.length > 0 ? comments.join("\n") : undefined;
}

/**
 * The innermost call whose argument list holds the cursor, and the index of
 * the argument being written. Tokens rather than characters, so comments are
 * skipped; commas count only at the call's own nesting level, and a template
 * list such as `array<f32, 4>(` belongs to its callee. A `;` or brace ends any
 * call, which bounds the scan when earlier code is broken.
 */
function callAt(source: string, position: Position): { name: string; parameter: number } | undefined {
  const offset = positionOffset(source, position);
  if (offset === undefined) {
    return undefined;
  }
  const tokens = tokenizeWgsl(source.slice(0, offset)).filter((token) => token.kind !== "eof");
  let frames: { name?: string; commas: number; close: ")" | "]" }[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind === "identifier" && tokens[index + 1]?.text === "<") {
      const close = templateListEnd(tokens, index + 1);
      if (close !== undefined && tokens[close + 1]?.text === "(") {
        frames.push({ name: token.text, commas: 0, close: ")" });
        index = close + 1;
        continue;
      }
    }
    switch (token.text) {
      case "(": {
        const callee = tokens[index - 1];
        // `fn name(` opens a parameter list, and keywords open plain groups.
        const isCall = callee?.kind === "identifier" && tokens[index - 2]?.text !== "fn";
        frames.push({ ...(isCall ? { name: callee.text } : {}), commas: 0, close: ")" });
        break;
      }
      case "[":
        frames.push({ commas: 0, close: "]" });
        break;
      case ")":
      case "]": {
        const open = frames.map((frame) => frame.close).lastIndexOf(token.text);
        if (open >= 0) {
          frames = frames.slice(0, open);
        }
        break;
      }
      case ",": {
        const frame = frames[frames.length - 1];
        if (frame) {
          frame.commas += 1;
        }
        break;
      }
      case ";":
      case "{":
      case "}":
        frames = [];
        break;
    }
  }
  const call = [...frames].reverse().find((frame) => frame.name !== undefined);
  return call?.name === undefined ? undefined : { name: call.name, parameter: call.commas };
}

/** Index of the `>` closing the template list opened at `start`, if the prefix closes it. */
function templateListEnd(tokens: readonly WgslToken[], start: number): number | undefined {
  let depth = 0;
  let nesting = 0;
  for (let index = start; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (text === "(" || text === "[") {
      nesting += 1;
    } else if (text === ")" || text === "]") {
      if (nesting === 0) {
        return undefined;
      }
      nesting -= 1;
    } else if (text === ";" || text === "{" || text === "}" || text === "=" || text === "&&" || text === "||") {
      return undefined;
    } else if (nesting === 0 && text === "<") {
      depth += 1;
    } else if (nesting === 0 && (text === ">" || text === ">>")) {
      depth -= text.length;
      if (depth <= 0) {
        return depth === 0 ? index : undefined;
      }
    }
  }
  return undefined;
}

interface WgslLiteralColor {
  readonly color: { red: number; green: number; blue: number; alpha: number };
  readonly range: Range;
  /** Constructor text through its opening parenthesis, exactly as authored. */
  readonly head: string;
  readonly components: 3 | 4;
}

/** `vec3f`/`vec4f` and `vec3<f32>`/`vec4<f32>`, with WGSL's optional template whitespace. */
const WGSL_COLOR_CONSTRUCTOR = /\bvec([34])(?:f|\s*<\s*f32\s*>)\s*\(([^()]*)\)/g;

function findWgslLiteralColors(source: string): WgslLiteralColor[] {
  const colors: WgslLiteralColor[] = [];
  for (const match of source.matchAll(WGSL_COLOR_CONSTRUCTOR)) {
    const components = match[1] === "3" ? 3 : 4;
    const color = literalColorFromArguments(match[2] ?? "", components);
    if (!color) {
      continue;
    }
    const start = match.index;
    colors.push({
      color,
      range: { start: offsetPosition(source, start), end: offsetPosition(source, start + match[0].length) },
      head: match[0].slice(0, match[0].indexOf("(") + 1),
      components,
    });
  }
  return colors;
}

function offsetPosition(source: string, offset: number): Position {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 };
}

function rangeKey(range: Range): string {
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}

function errorDiagnostic(range: Range, code: string, message: string): Diagnostic {
  return { range, severity: DiagnosticSeverity.Error, source: SERVICE_SOURCE, code, message };
}

/**
 * Predeclared WGSL names the parser records as references: inferred-type
 * constructors (`array(...)`, `vec3(...)`), texel formats in storage texture
 * templates, and types it does not classify as values.
 */
const WGSL_PREDECLARED_NAMES = new Set([
  "array", "atomic", "ptr", "vec2", "vec3", "vec4",
  "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
  "texture_external",
  "rgba8unorm", "rgba8snorm", "rgba8uint", "rgba8sint", "rgba16uint", "rgba16sint", "rgba16float",
  "rgba16unorm", "rgba16snorm", "rgba32uint", "rgba32sint", "rgba32float", "bgra8unorm",
  "r8unorm", "r8snorm", "r8uint", "r8sint", "r16uint", "r16sint", "r16float", "r16unorm", "r16snorm",
  "rg8unorm", "rg8snorm", "rg8uint", "rg8sint", "rg16uint", "rg16sint", "rg16float", "rg16unorm", "rg16snorm",
  "r32uint", "r32sint", "r32float", "rg32uint", "rg32sint", "rg32float",
  "rgb10a2uint", "rgb10a2unorm", "rg11b10ufloat",
]);

/**
 * Names every reference may resolve to. WGSL module-scope declarations are
 * order independent, so any global in the document counts, while locals were
 * already resolved in declaration order by the parser.
 */
function knownWgslNames(
  analysis: WgslAnalysisDocument,
  environment: ShaderAuthoringEnvironment,
  includes: readonly WgslAnalysisDocument[],
): Set<string> {
  const names = new Set(WGSL_PREDECLARED_NAMES);
  for (const document of [analysis, ...includes]) {
    const global = document.scopes.find((scope) => scope.parentId === undefined);
    for (const symbol of document.symbols) {
      if (symbol.scopeId === global?.id) {
        names.add(symbol.name);
      }
    }
  }
  for (const intrinsic of WGSL_INTRINSICS) {
    // Builtin values such as `position` only appear inside attributes.
    if (intrinsic.kind === "function") {
      names.add(intrinsic.name);
    }
  }
  for (const doc of SHADER_STUDIO_SYMBOL_DOCS) {
    if (doc.languages.includes("wgsl") && (!doc.stages || doc.stages.includes(environment.stage))) {
      names.add(doc.name);
    }
  }
  for (const item of [...environment.customUniforms, ...environment.resources, ...generatedWgslFunctions(environment)]) {
    names.add(item.name);
  }
  return names;
}

/** Reserved words tokenize as identifiers, so the parser accepts them as declaration names. */
function reservedWordDiagnostics(analysis: WgslAnalysisDocument): Diagnostic[] {
  return analysis.symbols
    .filter((symbol) => !analysis.hostGlobalIds.has(symbol.id) && isWgslReservedWord(symbol.name))
    .map((symbol) => errorDiagnostic(symbol.declaration, "reserved-word", `'${symbol.name}' is a reserved word in WGSL and cannot name a declaration.`));
}

function unresolvedReferenceDiagnostics(
  analysis: WgslAnalysisDocument,
  environment: ShaderAuthoringEnvironment,
  includes: readonly WgslAnalysisDocument[],
): Diagnostic[] {
  const known = knownWgslNames(analysis, environment, includes);
  return analysis.unresolvedReferences.flatMap((reference) => {
    if (known.has(reference.name)) {
      return [];
    }
    const label = reference.kind === "function" ? "function" : reference.kind === "type" ? "type" : "identifier";
    return reference.ranges.map((range) => errorDiagnostic(range, `undefined-${label}`, `Undefined ${label} '${reference.name}'.`));
  });
}

/** Builtins the WGSL specification restricts to the fragment stage, with their explicit alternative. */
const FRAGMENT_ONLY_BUILTINS = new Map<string, string | undefined>([
  ["textureSample", "textureSampleLevel with an explicit level"],
  ["textureSampleBias", "textureSampleLevel with an explicit level"],
  ["textureSampleCompare", "textureSampleCompareLevel"],
  ["dpdx", undefined], ["dpdxCoarse", undefined], ["dpdxFine", undefined],
  ["dpdy", undefined], ["dpdyCoarse", undefined], ["dpdyFine", undefined],
  ["fwidth", undefined], ["fwidthCoarse", undefined], ["fwidthFine", undefined],
]);

const COMPUTE_ONLY_BUILTINS = new Set(["storageBarrier", "textureBarrier", "workgroupBarrier", "workgroupUniformLoad"]);

/**
 * Stage-restricted builtins and `discard` in functions reachable from this
 * document's entries for the stage, as the compiler validates them. Calls into
 * Common are followed with this pass's stage: a violation inside Common is
 * reported at the pass call that reaches it, naming the chain and Common line,
 * because the pass is what makes that helper invalid. Helpers no entry calls
 * are left alone, so shared Common code used by other stages stays quiet.
 */
function stageDiagnostics(
  analysis: WgslAnalysisDocument,
  environment: ShaderAuthoringEnvironment,
  includes: readonly WgslAnalysisDocument[],
): Diagnostic[] {
  const pipelineStage = wgslStage(environment.stage);
  const tokens = tokenizeWgsl(analysis.source);
  const bodies = functionBodies(analysis, tokens);
  const included = new Map<string, { body: WgslToken[]; uri: string }>();
  for (const document of includes) {
    for (const [name, body] of functionBodies(document, tokenizeWgsl(document.source))) {
      if (!bodies.has(name) && !included.has(name)) {
        included.set(name, { body, uri: document.uri });
      }
    }
  }
  // An authored function of a builtin's name shadows that builtin everywhere.
  const authoredFunctions = new Set([...bodies.keys(), ...included.keys()]);
  const pending = [...stageEntryNames(tokens, pipelineStage)].filter((name) => bodies.has(name));
  const reachable = new Set<string>();
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (reachable.has(name)) {
      continue;
    }
    reachable.add(name);
    for (const callee of calledNames(bodies.get(name)!)) {
      if (bodies.has(callee.text) && callee.text !== name) {
        pending.push(callee.text);
      }
    }
  }
  const throughIncludes = new Map<string, IncludedStageViolation[]>();
  const diagnostics: Diagnostic[] = [];
  for (const name of reachable) {
    const body = bodies.get(name)!;
    for (const use of restrictedStageUses(body, pipelineStage, authoredFunctions)) {
      diagnostics.push(errorDiagnostic(tokenRange(use.token), use.code, `${use.message}.`));
    }
    for (const callee of calledNames(body)) {
      if (!included.has(callee.text)) {
        continue;
      }
      const violations = throughIncludes.get(callee.text)
        ?? includedStageViolations(callee.text, included, pipelineStage, authoredFunctions);
      throughIncludes.set(callee.text, violations);
      for (const violation of violations) {
        const owner = violation.uri === environment.commonFile?.uri ? "Common" : "an included file";
        const file = violation.uri.slice(violation.uri.lastIndexOf("/") + 1);
        diagnostics.push(errorDiagnostic(tokenRange(callee), violation.code,
          `${violation.message}; reached through ${owner}: ${violation.chain.join(" → ")} (${file} line ${violation.line + 1}).`));
      }
    }
  }
  return diagnostics;
}

interface RestrictedStageUse {
  readonly token: WgslToken;
  readonly code: "stage-unavailable-builtin" | "stage-unavailable-statement";
  readonly message: string;
}

interface IncludedStageViolation {
  readonly code: RestrictedStageUse["code"];
  readonly message: string;
  readonly chain: readonly string[];
  readonly uri: string;
  readonly line: number;
}

function functionBodies(analysis: WgslAnalysisDocument, tokens: readonly WgslToken[]): Map<string, WgslToken[]> {
  const bodies = new Map<string, WgslToken[]>();
  for (const scope of analysis.scopes) {
    if (scope.kind === "function" && !bodies.has(scope.name)) {
      bodies.set(scope.name, tokens.filter((token) => token.kind !== "eof"
        && rangeContains(scope.range, { start: { line: token.line, character: token.character }, end: { line: token.line, character: token.character } })));
    }
  }
  return bodies;
}

function restrictedStageUses(
  body: readonly WgslToken[],
  stage: "fragment" | "vertex" | "compute",
  authoredFunctions: ReadonlySet<string>,
): RestrictedStageUse[] {
  const uses: RestrictedStageUse[] = [];
  for (const callee of calledNames(body)) {
    if (authoredFunctions.has(callee.text)) {
      continue;
    }
    if (stage !== "fragment" && FRAGMENT_ONLY_BUILTINS.has(callee.text)) {
      const alternative = FRAGMENT_ONLY_BUILTINS.get(callee.text);
      uses.push({ token: callee, code: "stage-unavailable-builtin",
        message: `'${callee.text}' is only available in the fragment stage${alternative ? `; use ${alternative}` : ""}` });
    } else if (stage !== "compute" && COMPUTE_ONLY_BUILTINS.has(callee.text)) {
      uses.push({ token: callee, code: "stage-unavailable-builtin", message: `'${callee.text}' is only available in the compute stage` });
    }
  }
  if (stage !== "fragment") {
    for (const token of body) {
      if (token.kind === "keyword" && token.text === "discard") {
        uses.push({ token, code: "stage-unavailable-statement", message: "'discard' is only available in the fragment stage" });
      }
    }
  }
  return uses.sort((left, right) => left.token.offset - right.token.offset);
}

/** Every restricted use an included helper reaches, each with the call chain from that helper; cycles end the walk. */
function includedStageViolations(
  root: string,
  included: ReadonlyMap<string, { body: WgslToken[]; uri: string }>,
  stage: "fragment" | "vertex" | "compute",
  authoredFunctions: ReadonlySet<string>,
): IncludedStageViolation[] {
  const violations: IncludedStageViolation[] = [];
  const visited = new Set<string>();
  const visit = (name: string, chain: readonly string[]): void => {
    const helper = included.get(name);
    if (!helper || visited.has(name)) {
      return;
    }
    visited.add(name);
    const path = [...chain, name];
    for (const use of restrictedStageUses(helper.body, stage, authoredFunctions)) {
      violations.push({ code: use.code, message: use.message, chain: path, uri: helper.uri, line: use.token.line });
    }
    for (const callee of calledNames(helper.body)) {
      if (callee.text !== name) {
        visit(callee.text, path);
      }
    }
  };
  visit(root, []);
  return violations;
}

/** Shader Studio's hook for the stage, plus functions carrying the stage attribute. */
function stageEntryNames(tokens: readonly WgslToken[], stage: "fragment" | "vertex" | "compute"): Set<string> {
  const names = new Set<string>(stage === "fragment" ? ["mainImage"] : stage === "vertex" ? ["mainVertex"] : []);
  for (let index = 0; index < tokens.length; index++) {
    const name = tokens[index + 1];
    if (tokens[index]!.text !== "fn" || name?.kind !== "identifier") {
      continue;
    }
    for (let attribute = index - 1; attribute >= 0 && tokens[attribute]!.text !== "}" && tokens[attribute]!.text !== ";"; attribute--) {
      if (tokens[attribute]!.kind === "attribute" && tokens[attribute + 1]?.text === stage) {
        names.add(name.text);
      }
    }
  }
  return names;
}

function calledNames(body: readonly WgslToken[]): WgslToken[] {
  return body.filter((token, index) => token.kind === "identifier" && body[index + 1]?.text === "(");
}

function tokenRange(token: WgslToken): Range {
  return {
    start: { line: token.line, character: token.character },
    end: { line: token.line, character: token.character + token.text.length },
  };
}

/** Generated channel helpers that sample with implicit derivatives do not exist outside fragment stages. */
function samplingStageWarnings(
  analysis: WgslAnalysisDocument,
  environment: ShaderAuthoringEnvironment,
  includes: readonly WgslAnalysisDocument[],
): Diagnostic[] {
  if (environment.stage === "fragment") {
    return [];
  }
  const unavailable = new Map<string, string>([["sample2D", "sample2DLevel"], ["sampleCube", "sampleCubeLevel"]]);
  for (const resource of environment.resources) {
    if (resource.kind !== "storage") {
      unavailable.set(`${resource.name}Sample`, `${resource.name}SampleLevel`);
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const reference of analysis.unresolvedReferences) {
    const replacement = unavailable.get(reference.name);
    if (!replacement || reference.kind !== "function") {
      continue;
    }
    // An authored function, here or in Common, may shadow a generated helper.
    if ([analysis, ...includes].some((document) => document.uri !== CHANNEL_DECLARATIONS_URI
      && document.symbols.some((symbol) => symbol.name === reference.name && symbol.kind === "function"))) {
      continue;
    }
    for (const range of reference.ranges) {
      diagnostics.push({
        range, severity: DiagnosticSeverity.Warning, source: SERVICE_SOURCE,
        code: "sampling-requires-fragment",
        message: `${reference.name} requires a fragment stage; use ${replacement} with an explicit mip level.`,
      });
    }
  }
  return diagnostics;
}

/** Declared result structures of builtins whose fields completion and hover can name. */
const BUILTIN_RESULT_FIELDS: Readonly<Record<string, readonly { name: string; type: string; description: string }[]>> = {
  __modfResult: [
    { name: "fract", type: "T", description: "Fractional part, with the argument's type." },
    { name: "whole", type: "T", description: "Whole part, with the argument's type." },
  ],
  __frexpResult: [
    { name: "fract", type: "T", description: "Normalized fraction in [0.5, 1), with the argument's type." },
    { name: "exp", type: "i32 or vecN<i32>", description: "Base-2 exponent, per component." },
  ],
};

/** Environment declarations that document inference may consult. */
function inferenceContext(environment: ShaderAuthoringEnvironment, includes: readonly WgslAnalysisDocument[]): WgslInferenceContext {
  const context = expressionContext(environment, includes);
  return { valueType: context.variableType, functionType: context.functionType, fieldType: context.fieldType };
}

/** A field of a struct declared in Common or generated declarations, following their aliases. */
function includedFieldType(includes: readonly WgslAnalysisDocument[], owner: string, field: string): string | undefined {
  const symbols = includes.flatMap((document) => document.symbols);
  let typeName = owner;
  for (const visited = new Set<string>(); !visited.has(typeName);) {
    visited.add(typeName);
    const alias = symbols.find((symbol) => symbol.kind === "type" && symbol.name === typeName && symbol.typeName !== undefined);
    if (!alias?.typeName) {
      break;
    }
    typeName = alias.typeName;
  }
  for (const document of includes) {
    const scope = document.scopes.find((candidate) => candidate.kind === "type" && candidate.name === typeName);
    const match = scope && document.symbols.find((symbol) => symbol.kind === "field" && symbol.scopeId === scope.id && symbol.name === field);
    if (match?.typeName) {
      return match.typeName;
    }
  }
  return undefined;
}

function expressionContext(environment: ShaderAuthoringEnvironment, includes: readonly WgslAnalysisDocument[]) {
  return {
    variableType: (name: string) => environmentTypeName(name, environment) ?? includedGlobalType(includes, name, false),
    functionType: (name: string) => includedGlobalType(includes, name, true)
      ?? generatedWgslFunctions(environment).find((item) => item.name === name)?.returnType
      ?? uniqueIntrinsicReturnType(environment.stage, name),
    fieldType: (owner: string, field: string) => includedFieldType(includes, owner, field),
  };
}

function includedGlobalType(includes: readonly WgslAnalysisDocument[], name: string, isFunction: boolean): string | undefined {
  for (const document of includes) {
    const global = document.scopes.find((scope) => scope.parentId === undefined);
    const symbol = document.symbols.find((candidate) => candidate.name === name && candidate.scopeId === global?.id
      && (isFunction ? candidate.kind === "function" : candidate.kind === "variable" || candidate.kind === "constant"));
    if (symbol?.typeName) {
      return symbol.typeName;
    }
  }
  return undefined;
}

/** An overload set's return type only when every overload agrees, such as textureSample's vec4f. */
function uniqueIntrinsicReturnType(stage: ShaderAuthoringEnvironment["stage"], name: string): string | undefined {
  const returns = new Set(visibleIntrinsics(stage)
    .filter((item) => item.kind === "function" && item.name === name)
    .map((item) => item.returnType));
  return returns.size === 1 ? [...returns][0] : undefined;
}

interface IdentifierSite {
  readonly kind: "attribute-name" | "attribute-argument" | "member" | "plain";
  readonly start: Position;
  readonly name: string;
}

/** Where the identifier under the cursor sits syntactically, from tokens so comments never count. */
function identifierSite(source: string, position: Position): IdentifierSite | undefined {
  const tokens = tokenizeWgsl(source);
  const index = tokens.findIndex((token) => token.kind === "identifier" && token.line === position.line
    && token.character <= position.character && position.character <= token.character + token.text.length);
  const token = tokens[index];
  if (!token) {
    return undefined;
  }
  const site = { start: { line: token.line, character: token.character }, name: token.text };
  if (tokens[index - 1]?.kind === "attribute") {
    return { ...site, kind: "attribute-name" };
  }
  if (tokens[index - 1]?.text === ".") {
    return { ...site, kind: "member" };
  }
  for (let cursor = index - 1, depth = 0; cursor >= 0; cursor--) {
    const text = tokens[cursor]!.text;
    if (text === ")") {
      depth += 1;
    } else if (text === "(" && depth > 0) {
      depth -= 1;
    } else if (text === "(") {
      return tokens[cursor - 2]?.kind === "attribute" ? { ...site, kind: "attribute-argument" } : { ...site, kind: "plain" };
    } else if (text === ";" || text === "{" || text === "}") {
      break;
    }
  }
  return { ...site, kind: "plain" };
}

/** A member selection hovers by its owner's type, and not at all when that type is unknown. */
function memberHover(
  site: IdentifierSite,
  source: string,
  uri: string,
  environment: ShaderAuthoringEnvironment,
  includes: readonly WgslAnalysisDocument[],
): Hover | null {
  const access = findMemberAccess(source, site.start);
  const resolved = access && resolveWgslExpressionType(
    { uri, source, stage: environment.stage, position: site.start, expression: access.expression },
    { includes, ...expressionContext(environment, includes) },
  );
  if (!access || !resolved) {
    return null;
  }
  const result = BUILTIN_RESULT_FIELDS[resolved.name]?.find((field) => field.name === site.name);
  if (result) {
    return markdownHover(typedName(site.name, result.type), result.description);
  }
  const vector = resolved.vector;
  if (vector) {
    const set = WGSL_SWIZZLE_SETS.find((candidate) => [...site.name].every((component) => candidate.slice(0, vector.size).includes(component)));
    const type = site.name.length === 1 ? vector.componentType : wgslVectorTypeName(vector.componentType, site.name.length);
    return set && site.name.length <= 4 && type
      ? markdownHover(typedName(site.name, type), `Component selection on \`${access.expression}\`.`)
      : null;
  }
  const field = resolved.fields?.find((candidate) => candidate.name === site.name);
  return field ? markdownHover(typedName(site.name, field.type), `Field of \`${resolved.name}\`.`) : null;
}
