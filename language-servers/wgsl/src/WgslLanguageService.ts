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
  type SignatureHelp,
  type WorkspaceEdit,
} from "vscode-languageserver-protocol";
import {
  DocumentStore,
  VirtualFileSystem,
  findLiteralConstructorColors,
  findMemberAccess,
  isPositionInComment,
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
  isShaderLanguageReservedTerm,
  isValidShaderIdentifier,
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "@shader-studio/types";
import {
  parseWgslDocument,
  parseWgslDocumentAtPosition,
  resolveWgslExpressionType,
  symbolAtPosition,
  tokenizeWgsl,
  visibleSymbolsAtPosition,
  wgslVectorTypeName,
  type WgslAnalysisDocument,
  type WgslSymbol,
} from "@shader-studio/wgsl-analysis";
import { WGSL_INTRINSICS, findWgslIntrinsics } from "./intrinsics.js";
import { WGSL_VERTEX_HOOK_FEATURES, type WgslVertexHookFeature } from "./vertexHook.js";
import {
  WGSL_MAIN_IMAGE_COORDINATE_DESCRIPTION,
  WGSL_MAIN_IMAGE_DESCRIPTION,
} from "./fragmentHook.js";

const CAPABILITIES: ServerCapabilities = {
  completion: true,
  hover: true,
  definition: true,
  signatureHelp: true,
  documentSymbols: true,
  // WGSL diagnostics come from the renderer compiler, which is the only WGSL
  // error source. The service contributes only hints and warnings.
  diagnostics: false,
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
    this.includeAnalyses.set(environment.documentUri, contextFiles.map((file) => (
      parseWgslDocument(file.uri, file.text, environment.stage)
    )));
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
    // The statement being completed is rarely valid WGSL, and a failed parse leaves the
    // analysis with no symbols at all, so recover the declarations that precede it.
    const analysis = state.analysis.parsedSuccessfully
      ? state.analysis
      : parseWgslDocumentAtPosition(
        params.document.uri,
        state.document.text,
        state.environment.stage,
        params.position,
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
    }
    for (const analysis of this.includeAnalyses.get(params.document.uri) ?? []) {
      for (const symbol of analysis.symbols) {
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
      if (doc.name === "iChannelN" || !doc.languages.includes("wgsl") || (doc.stages && !doc.stages.includes(state.environment.stage))) {
        continue;
      }
      items.set(doc.name, completionFromDoc(doc.name, doc.wgslType, doc.description));
    }
    for (const uniform of state.environment.customUniforms) {
      items.set(uniform.name, completionFromDoc(uniform.name, authoringValueWgslType(uniform.type), "Shader Studio custom uniform."));
    }
    for (const resource of state.environment.resources) {
      items.set(resource.name, completionFromDoc(resource.name, resource.kind, "Shader Studio shader resource."));
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
    const userSymbol = symbolAtPosition(state.analysis, params.position)
      ?? visibleSymbolsAtPosition(state.analysis, params.position).find((symbol) => symbol.name === word)
      ?? state.analysis.symbols.find((symbol) => symbol.name === word);
    if (userSymbol) {
      const vertexHook = state.environment.stage === "vertex" ? vertexHookFeature(state.analysis, userSymbol) : undefined;
      if (vertexHook) {
        return markdownHover(vertexHook.signature, vertexHook.description);
      }
      const fragmentHook = state.environment.stage === "fragment" ? mainImageFeature(state.analysis, userSymbol) : undefined;
      if (fragmentHook) {
        return markdownHover(fragmentHook.signature, fragmentHook.description);
      }
      return markdownHover(userSymbol.signature ?? `${userSymbol.typeName ?? userSymbol.kind} ${userSymbol.name}`, "Declared in this shader.");
    }
    for (const analysis of this.includeAnalyses.get(params.document.uri) ?? []) {
      const included = analysis.symbols.find((symbol) => symbol.name === word);
      if (included) {
        const description = analysis.uri === state.environment.commonFile?.uri
          ? "Declared in Shader Studio Common."
          : "Declared in an included shader file.";
        return markdownHover(included.signature ?? `${included.typeName ?? included.kind} ${included.name}`, description);
      }
    }
    const doc = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === word && item.languages.includes("wgsl"));
    if (doc) {
      return markdownHover(`${doc.wgslType ?? "built-in"} ${doc.name}`, doc.description);
    }
    const uniform = state.environment.customUniforms.find((item) => item.name === word);
    if (uniform) {
      return markdownHover(`${authoringValueWgslType(uniform.type)} ${uniform.name}`, "Shader Studio custom uniform.");
    }
    const resource = state.environment.resources.find((item) => item.name === word);
    if (resource) {
      return markdownHover(`${resource.kind} ${resource.name}`, "Shader Studio shader resource.");
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
    if (symbol) {
      return [{ uri: params.document.uri, range: symbol.declaration }];
    }
    for (const analysis of this.includeAnalyses.get(params.document.uri) ?? []) {
      const included = analysis.symbols.find((candidate) => candidate.name === name);
      if (included) {
        return [{ uri: analysis.uri, range: included.declaration }];
      }
    }
    return [];
  }

  async signatureHelp(params: DocumentPositionParams): Promise<SignatureHelp | null> {
    const state = this.current(params);
    if (!state) {
      return null;
    }
    if (isPositionInComment(state.document.text, params.position)) {
      return null;
    }
    const call = callAt(state.document.text, params.position);
    if (!call) {
      return null;
    }
    const user = state.analysis.symbols.filter((symbol) => symbol.kind === "function" && symbol.name === call.name && symbol.signature);
    const contextual = (this.includeAnalyses.get(params.document.uri) ?? []).flatMap((analysis) => (
      analysis.symbols.filter((symbol) => symbol.kind === "function" && symbol.name === call.name && symbol.signature)
    ));
    const intrinsic = findWgslIntrinsics(call.name).filter((item) => item.stages.includes(wgslStage(state.environment.stage)));
    const labels = [
      ...user.map((symbol) => symbol.signature!),
      ...contextual.map((symbol) => symbol.signature!),
      ...intrinsic.map((item) => item.signature),
    ];
    if (labels.length === 0) {
      return null;
    }
    return { signatures: labels.map((label) => ({ label })), activeSignature: 0, activeParameter: call.parameter };
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
    const symbol = state ? symbolAtPosition(state.analysis, params.position) : null;
    if (!symbol) {
      return state ? this.includedReferences(state, params, params.includeDeclaration) : [];
    }
    const ranges = params.includeDeclaration
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
    const symbol = state ? symbolAtPosition(state.analysis, params.position) : null;
    if (!symbol) {
      if (!state) {
        return [];
      }
      const included = this.includedSymbolAt(state, params.position);
      return included ? orderedRanges(includedReferenceRanges(state.analysis, included.symbol))
        .map((range) => ({ range, kind: DocumentHighlightKind.Read })) : [];
    }
    return [
      { range: symbol.declaration, kind: DocumentHighlightKind.Write },
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
    if (!state || !target || !ownerUri || (symbol && state.analysis.hostGlobalIds.has(symbol.id))
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
   * Hints and warnings the renderer compiler cannot see. Errors are never
   * reported here: for WGSL the browser compiler is the only error source and
   * its diagnostics flow straight through the arbiter.
   */
  async diagnostics(params: DocumentParams): Promise<Diagnostic[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const diagnostics: Diagnostic[] = unusedSymbolDiagnostics(state.analysis);
    diagnostics.push(...validateShaderAuthoringEnvironment(state.environment).map((issue) => ({
      range: zeroRange(),
      severity: DiagnosticSeverity.Warning,
      source: "shader-studio-wgsl-ls",
      code: issue.code,
      message: issue.message,
    })));
    return diagnostics;
  }

  async documentColors(params: DocumentParams) {
    const state = this.current(params);
    return state ? findLiteralConstructorColors(state.document.text, ["vec3f", "vec4f"]) : [];
  }

  async colorPresentations(params: ColorPresentationParams) {
    if (!this.store.isCurrent(params.document)) {
      return [];
    }
    const source = this.store.getDocument(params.document.uri)?.text;
    const components = componentCountAt(source, params.range) ?? 4;
    const constructor = `vec${components}f`;
    const channels = components === 3
      ? [params.color.red, params.color.green, params.color.blue]
      : [params.color.red, params.color.green, params.color.blue, params.color.alpha];
    const label = `${constructor}(${channels.map(formatColorComponent).join(", ")})`;
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
    this.analyses.set(uri, parseWgslDocument(uri, document.text, environment.stage));
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
  const resolved = resolveWgslExpressionType({ uri, source, stage: environment.stage, position, expression }, {
    includes,
    variableType: (name) => environmentTypeName(name, environment),
    functionType: (name) => visibleIntrinsics(environment.stage)
      .find((item) => item.kind === "function" && item.name === name)?.returnType,
  });
  if (!resolved) {
    return [];
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

function componentCountAt(source: string | undefined, range: Range): 3 | 4 | undefined {
  if (source === undefined) {
    return undefined;
  }
  const lines = source.split("\n");
  const line = lines[range.start.line];
  if (line === undefined) {
    return undefined;
  }
  const before = line.slice(0, range.start.character);
  if (/vec3f\s*\($/.test(before)) {
    return 3;
  }
  if (/vec4f\s*\($/.test(before)) {
    return 4;
  }
  return undefined;
}

function formatColorComponent(value: number): string {
  return String(Math.round(value * 1000) / 1000);
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

function callAt(source: string, position: Position): { name: string; parameter: number } | undefined {
  const lines = source.split("\n");
  if (!lines[position.line]) {
    return undefined;
  }
  const offset = lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
  const prefix = source.slice(0, offset);
  let depth = 0;
  for (let index = prefix.length - 1; index >= 0; index--) {
    if (prefix[index] === ")") {
      depth++;
    } else if (prefix[index] === "(") {
      if (depth > 0) {
        depth--;
      } else {
        const name = prefix.slice(0, index).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/)?.[1];
        if (!name) {
          return undefined;
        }
        const parameter = prefix.slice(index + 1).split(",").length - 1;
        return { name, parameter };
      }
    }
  }
  return undefined;
}

function zeroRange() {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
