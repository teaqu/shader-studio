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
  createLiteralColorPresentations,
  declarationContext,
  rankCompletionsForContext,
  findLiteralConstructorColors,
  findMemberAccess,
  isInsideBlock,
  isPositionInComment,
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
  buildGlslAuthoringPreamble,
  isShaderEntryPointName,
  isShaderTypeKeyword,
  shaderTypeCompletionKeywords,
  shaderValueTypeKeywords,
  isShaderLanguageReservedTerm,
  isValidShaderIdentifier,
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "@shader-studio/types";
import {
  glslVectorTypeName,
  parseGlslDocument,
  parseGlslDocumentAtPosition,
  resolveGlslExpressionType,
  symbolAtPosition,
  visibleSymbolsAtPosition,
  type GlslAnalysisDocument,
  type GlslSymbol,
} from "@shader-studio/glsl-analysis";
import { GLSL_INTRINSICS, findGlslIntrinsics } from "./intrinsics.js";
import { GLSL_VERTEX_HOOK_FEATURES, type GlslVertexHookFeature } from "./vertexHook.js";
import {
  GLSL_MAIN_IMAGE_COORDINATE_DESCRIPTION,
  GLSL_MAIN_IMAGE_DESCRIPTION,
  GLSL_MAIN_IMAGE_OUTPUT_DESCRIPTION,
} from "./fragmentHook.js";

const CAPABILITIES: ServerCapabilities = {
  completion: true,
  hover: true,
  definition: true,
  signatureHelp: true,
  documentSymbols: true,
  diagnostics: true,
  documentColors: true,
  references: true,
  documentHighlights: true,
  rename: true,
};

export class GlslLanguageService implements LanguageService {
  private readonly store = new DocumentStore();
  private readonly files = new VirtualFileSystem();
  private readonly analyses = new Map<string, GlslAnalysisDocument>();
  private readonly includeAnalyses = new Map<string, readonly GlslAnalysisDocument[]>();
  private readonly generatedAnalyses = new Map<string, GlslAnalysisDocument>();
  private readonly workspaceUris = new Set<string>();

  async initialize(): Promise<ServerCapabilities> {
    return CAPABILITIES;
  }

  async syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    if (environment.languageId !== "glsl" || !this.store.syncEnvironment(environment)) {
      return;
    }
    // Common is the only file GLSL shares symbols through. The preview compiles
    // GLSL without resolving #include, so the editor must not take symbols from
    // files a host supplies for one: they would complete here and fail there.
    const contextFiles = environment.commonFile ? [environment.commonFile] : [];
    this.files.replaceEnvironment(contextFiles);
    this.syncWorkspace(environment);
    this.includeAnalyses.set(environment.documentUri, contextFiles.map((file) => (
      parseGlslDocument(file.uri, file.text, environment.stage)
    )));
    this.rebuild(environment.documentUri);
  }

  async openDocument(document: ShaderDocumentSnapshot): Promise<void> {
    if (document.languageId !== "glsl" || !this.store.open(document)) {
      return;
    }
    this.files.openOverlay(document);
    this.rebuild(document.uri);
  }

  async changeDocument(document: ShaderDocumentSnapshot): Promise<void> {
    if (document.languageId !== "glsl" || !this.store.change(document)) {
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
    this.generatedAnalyses.delete(uri);
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
        [
          ...(this.generatedAnalyses.has(params.document.uri) ? [this.generatedAnalyses.get(params.document.uri)!] : []),
          ...(this.includeAnalyses.get(params.document.uri) ?? []),
        ],
        params.document.uri,
      );
    }
    // The statement being completed is rarely valid GLSL, and a failed parse leaves the
    // analysis with no symbols at all, so recover the declarations that precede it.
    const analysis = state.analysis.parsedSuccessfully
      ? state.analysis
      : parseGlslDocumentAtPosition(
        params.document.uri,
        state.document.text,
        state.environment.stage,
        params.position,
      );
    // A name is being invented after a type, so nothing that already exists fits.
    const context = declarationContext(
      state.document.text,
      params.position,
      (word) => isShaderTypeKeyword("glsl", word) || this.isDeclaredType(params.document.uri, analysis, word),
    );
    const items = new Map<string, CompletionItem>();
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
      const hook = GLSL_VERTEX_HOOK_FEATURES[0];
      if (hook && !items.has(hook.name)) {
        items.set(hook.name, {
          label: hook.name,
          kind: CompletionItemKind.Function,
          detail: hook.signature,
          documentation: markdownDocumentation(hook.description),
        });
      }
      for (const helper of vertexSamplerHelpers(state.environment)) {
        if (!items.has(helper.name)) {
          items.set(helper.name, {
            label: helper.name,
            kind: CompletionItemKind.Function,
            detail: helper.signature,
            documentation: markdownDocumentation(`Generated vertex-stage sampler for resource '${helper.resource}'.`),
          });
        }
      }
    }
    for (const intrinsic of visibleIntrinsics(state.document.text, state.environment.stage)) {
      const key = `${intrinsic.name}:${intrinsic.signature}`;
      items.set(key, {
        label: intrinsic.name,
        kind: intrinsic.kind === "function" ? CompletionItemKind.Function : CompletionItemKind.Variable,
        detail: intrinsic.signature,
        documentation: { kind: MarkupKind.Markdown, value: intrinsic.description },
      });
    }
    for (const doc of SHADER_STUDIO_SYMBOL_DOCS) {
      if (doc.name === "iChannelN" || !doc.languages.includes("glsl") || (doc.stages && !doc.stages.includes(state.environment.stage))) {
        continue;
      }
      items.set(doc.name, completionFromDoc(doc.name, doc.glslType, doc.description));
    }
    for (const symbol of this.generatedAnalyses.get(params.document.uri)?.symbols ?? []) {
      if (!/^iCh\d+$/.test(symbol.name)) {
        continue;
      }
      items.set(symbol.name, completionFromDoc(symbol.name, symbol.typeName ?? "ShaderToy channel metadata struct", "Shader Studio input channel metadata."));
    }
    for (const uniform of state.environment.customUniforms) {
      items.set(uniform.name, completionFromDoc(uniform.name, uniform.type, "Shader Studio custom uniform."));
    }
    for (const resource of state.environment.resources) {
      items.set(resource.name, completionFromDoc(resource.name, resource.kind, "Shader Studio shader resource."));
    }
    // A name is being invented, so the author's own symbols do not belong. The
    // renderer's entry points do: they have to be spelled exactly.
    if (context === "declarator") {
      return [...items.values()].filter((item) => isShaderEntryPointName(item.label));
    }
    const insideFunctionBody = isInsideBlock(state.document.text, params.position);
    for (const type of shaderTypeCompletionKeywords("glsl", { insideFunctionBody })) {
      if (!items.has(type)) {
        items.set(type, { label: type, kind: CompletionItemKind.Keyword, detail: "type" });
      }
    }
    return rankCompletionsForContext(
      [...items.values()],
      context,
      (label) => isShaderTypeKeyword("glsl", label),
    );
  }

  /** Whether the word names a struct declared by the document or anything it includes. */
  private isDeclaredType(uri: string, analysis: GlslAnalysisDocument, word: string): boolean {
    const analyses = [
      analysis,
      ...(this.includeAnalyses.get(uri) ?? []),
      ...(this.generatedAnalyses.has(uri) ? [this.generatedAnalyses.get(uri)!] : []),
    ];
    return analyses.some((analysis) => analysis.symbols.some((symbol) => (
      symbol.kind === "type" && symbol.name === word
    )));
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
    const memberStart = memberSelectionStart(state.document.text, params.position);
    if (memberStart) {
      return memberHover(word, memberStart, state.document.text, state.environment, [
        ...(this.generatedAnalyses.has(params.document.uri) ? [this.generatedAnalyses.get(params.document.uri)!] : []),
        ...(this.includeAnalyses.get(params.document.uri) ?? []),
      ], params.document.uri);
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
    const doc = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === word && item.languages.includes("glsl"));
    if (doc) {
      return markdownHover(`${doc.glslType ?? "built-in"} ${doc.name}`, doc.description);
    }
    const uniform = state.environment.customUniforms.find((item) => item.name === word);
    if (uniform) {
      return markdownHover(`${uniform.type} ${uniform.name}`, "Shader Studio custom uniform.");
    }
    const resource = state.environment.resources.find((item) => item.name === word);
    if (resource) {
      return markdownHover(`${resource.kind} ${resource.name}`, "Shader Studio shader resource.");
    }
    const samplerHelper = vertexSamplerHelpers(state.environment).find((helper) => helper.name === word);
    if (samplerHelper) {
      return markdownHover(samplerHelper.signature, `Generated vertex-stage sampler for resource '${samplerHelper.resource}'.`);
    }
    const intrinsic = findGlslIntrinsics(word, glslVersion(state.document.text), glslStage(state.environment.stage))[0];
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
    const intrinsic = findGlslIntrinsics(call.name, glslVersion(state.document.text), glslStage(state.environment.stage));
    const labels = [
      ...user.map((symbol) => symbol.signature!),
      ...contextual.map((symbol) => symbol.signature!),
      ...vertexSamplerHelpers(state.environment).filter((helper) => helper.name === call.name).map((helper) => helper.signature),
      ...intrinsic.map((item) => item.signature),
    ];
    if (labels.length === 0) {
      return null;
    }
    // Without type resolution, arity is the only reliable overload signal.
    const fitting = labels.findIndex((label) => signatureArity(label) > call.parameter);
    return { signatures: labels.map((label) => ({ label })), activeSignature: Math.max(0, fitting), activeParameter: call.parameter };
  }

  async documentSymbols(params: DocumentParams): Promise<DocumentSymbol[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    return state.analysis.symbols
      .filter((symbol) => symbol.scopeId === "scope:global" || symbol.kind === "function" || symbol.kind === "type")
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
    const included = state && !symbol ? this.includedSymbolAt(state, params.position) : undefined;
    const target = symbol ?? included?.symbol;
    const ownerUri = symbol ? params.document.uri : included?.analysis.uri;
    if (!state || !target || !ownerUri || !isRenameableName(params.newName) || this.nameIsTaken(state, params)) {
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
    for (const [uri, references] of shared) {
      changes[uri] = orderedRanges(references).map((range) => ({ range, newText: params.newName }));
    }
    return { changes };
  }

  async diagnostics(params: DocumentParams): Promise<Diagnostic[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const diagnostics: Diagnostic[] = state.analysis.diagnostics.map((item) => ({
      range: item.range,
      severity: DiagnosticSeverity.Error,
      source: "shader-studio-glsl-ls",
      code: item.code,
      message: item.message,
    }));
    diagnostics.push(...unresolvedReferenceDiagnostics(state.analysis, state.environment, this.includeAnalyses));
    diagnostics.push(...unusedSymbolDiagnostics(state.analysis));
    diagnostics.push(...validateShaderAuthoringEnvironment(state.environment).map((issue) => ({
      range: zeroRange(),
      severity: DiagnosticSeverity.Warning,
      source: "shader-studio-glsl-ls",
      code: issue.code,
      message: issue.message,
    })));
    return diagnostics;
  }

  async documentColors(params: DocumentParams) {
    const state = this.current(params);
    return state ? findLiteralConstructorColors(state.document.text, ["vec3", "vec4"]) : [];
  }

  async colorPresentations(params: ColorPresentationParams) {
    if (!this.store.isCurrent(params.document)) {
      return [];
    }
    return createLiteralColorPresentations("glsl", params.color, params.range, this.store.getDocument(params.document.uri)?.text);
  }

  async dispose(): Promise<void> {
    this.analyses.clear();
    this.includeAnalyses.clear();
    this.generatedAnalyses.clear();
  }

  private nameIsTaken(
    state: NonNullable<ReturnType<GlslLanguageService["current"]>>,
    params: RenameParams,
  ): boolean {
    const { newName } = params;
    return visibleSymbolsAtPosition(state.analysis, params.position).some((item) => item.name === newName)
      || state.environment.customUniforms.some((item) => item.name === newName)
      || state.environment.resources.some((item) => item.name === newName)
      || SHADER_STUDIO_SYMBOL_DOCS.some((item) => item.languages.includes("glsl") && item.name === newName)
      || visibleIntrinsics(state.document.text, state.environment.stage).some((item) => item.name === newName)
      || (this.includeAnalyses.get(params.document.uri) ?? [])
        .some((analysis) => analysis.symbols.some((item) => item.name === newName));
  }

  private includedSymbolAt(state: NonNullable<ReturnType<GlslLanguageService["current"]>>, position: Position): { analysis: GlslAnalysisDocument; symbol: GlslSymbol } | undefined {
    const name = wordAt(state.document.text, identifierPosition(state.document.text, position));
    return name === undefined ? undefined : (this.includeAnalyses.get(state.document.uri) ?? [])
      .map((analysis) => ({ analysis, symbol: analysis.symbols.find((candidate) => candidate.name === name) }))
      .find((candidate): candidate is { analysis: GlslAnalysisDocument; symbol: GlslSymbol } => candidate.symbol !== undefined);
  }

  private includedReferences(state: NonNullable<ReturnType<GlslLanguageService["current"]>>, params: ReferenceParams, includeDeclaration: boolean): Location[] {
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

  /** Each pass parses Common independently, so join its unresolved use sites. */
  private commonUses(symbol: GlslSymbol, ownerUri: string): Map<string, Range[]> {
    const uses = new Map<string, Range[]>();
    for (const [passUri, includes] of this.includeAnalyses) {
      if (!includes.some((analysis) => analysis.uri === ownerUri && analysis.symbols.some((candidate) => sameIncludedSymbol(candidate, symbol)))) {
        continue;
      }
      const pass = this.analyses.get(passUri);
      if (pass) {
        uses.set(passUri, includedReferenceRanges(pass, symbol));
      }
    }
    return uses;
  }

  private commonRenameCollides(uses: ReadonlyMap<string, readonly Range[]>, symbol: GlslSymbol, newName: string): boolean {
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
    const generated = buildGlslAuthoringPreamble(environment);
    this.generatedAnalyses.set(uri, parseGlslDocument(generated.uri, generated.text, environment.stage));
    this.analyses.set(uri, parseGlslDocument(uri, document.text, environment.stage));
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
      this.analyses.set(file.uri, parseGlslDocument(file.uri, text, file.stage));
      const common = file.commonUri === undefined ? undefined : workspaceDocuments
        .find((candidate) => candidate.uri === file.commonUri);
      this.includeAnalyses.set(file.uri, common
        ? [parseGlslDocument(common.uri, common.text, common.stage)]
        : []);
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
 * Names of the generated texture samplers a vertex hook runs with. Mirrors
 * ShaderCompiler.buildVertexChannelHelpers: slots 0-3 always get a
 * `sampleIChannelN` helper, each assigned texture slot gets one for its own
 * slot, and every custom-named channel additionally gets `sample<Name>`.
 * Without these the service reports false undefined-function errors for
 * every textured vertex hook.
 */
function vertexSamplerHelpers(environment: ShaderAuthoringEnvironment): { name: string; signature: string; resource: string }[] {
  if (environment.stage !== "vertex") {
    return [];
  }
  const textures = environment.resources.filter((item) =>
    (item.kind === "texture-2d" || item.kind === "texture-cube" || item.kind === "texture-3d")
    && item.slot !== undefined && item.slot >= 0);
  const maxSlot = Math.max(3, ...textures.map((item) => item.slot as number));
  const coordinateFor = (slot: number): string => {
    const resource = textures.find((item) => item.slot === slot);
    return resource?.kind === "texture-2d" ? "vec2" : resource ? "vec3" : "vec2";
  };
  const helpers: { name: string; signature: string; resource: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, resource: string, coordinate: string): void => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    helpers.push({ name, signature: `vec4 ${name}(${coordinate} uv)`, resource });
  };
  for (let slot = 0; slot <= maxSlot; slot++) {
    push(`sampleIChannel${slot}`, `iChannel${slot}`, coordinateFor(slot));
  }
  for (const item of textures) {
    if (item.name !== `iChannel${item.slot}`) {
      const coordinate = item.kind === "texture-2d" ? "vec2" : "vec3";
      push(`sample${item.name[0]!.toUpperCase()}${item.name.slice(1)}`, item.name, coordinate);
    }
  }
  return helpers;
}

function unresolvedReferenceDiagnostics(
  analysis: GlslAnalysisDocument,
  environment: ShaderAuthoringEnvironment,
  includeAnalyses: ReadonlyMap<string, readonly GlslAnalysisDocument[]>,
): Diagnostic[] {
  const knownNames = new Set<string>();
  for (const symbol of (includeAnalyses.get(analysis.uri) ?? []).flatMap((included) => included.symbols)) {
    knownNames.add(symbol.name);
  }
  for (const intrinsic of visibleIntrinsics(analysis.source, environment.stage)) {
    knownNames.add(intrinsic.name);
  }
  for (const documentation of SHADER_STUDIO_SYMBOL_DOCS) {
    if (
      documentation.languages.includes("glsl")
      && (!documentation.stages || documentation.stages.includes(environment.stage))
    ) {
      knownNames.add(documentation.name);
    }
  }
  for (const uniform of environment.customUniforms) {
    knownNames.add(uniform.name);
  }
  for (const resource of environment.resources) {
    knownNames.add(resource.name);
  }
  for (const helper of vertexSamplerHelpers(environment)) {
    knownNames.add(helper.name);
  }

  return analysis.unresolvedReferences.flatMap((reference) => {
    if (knownNames.has(reference.name)) {
      return [];
    }
    const label = reference.kind === "function" ? "function"
      : reference.kind === "type" ? "type"
        : "identifier";
    return reference.ranges.map((range): Diagnostic => ({
      range,
      severity: DiagnosticSeverity.Error,
      source: "shader-studio-glsl-ls",
      code: `undefined-${label}`,
      message: `Undefined ${label} '${reference.name}'.`,
    }));
  });
}

/**
 * Warns about local variables and parameters nothing reads. Globals stay
 * quiet because uniforms and shared helpers are often set or used outside the
 * document, and functions are entry points or API surface rather than dead
 * locals. Assignments count as references in the analysis, so an `out`
 * parameter the body writes to is considered used.
 */
function unusedSymbolDiagnostics(analysis: GlslAnalysisDocument): Diagnostic[] {
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
      source: "shader-studio-glsl-ls",
      code: `unused-${label}`,
      message: `Unused ${label} '${symbol.name}'.`,
      tags: [DiagnosticTag.Unnecessary],
    }];
  });
}

function isRenameableName(name: string): boolean {
  return isValidShaderIdentifier(name) && !isShaderLanguageReservedTerm("glsl", name);
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

function symbolAtRenamePosition(document: GlslAnalysisDocument, position: Position): GlslSymbol | null {
  return symbolAtPosition(document, position) ?? symbolAtPosition(document, identifierPosition(document.source, position));
}

function identifierPosition(source: string, position: Position): Position {
  const line = source.split("\n")[position.line];
  return position.character > 0 && line?.[position.character - 1] !== undefined && /[A-Za-z0-9_]/.test(line[position.character - 1]!)
    ? { line: position.line, character: position.character - 1 }
    : position;
}

/** Include declarations are unresolved in the pass analysis and therefore have no symbol links there. */
function includedReferenceRanges(analysis: GlslAnalysisDocument, symbol: GlslSymbol): Range[] {
  return analysis.unresolvedReferences
    .filter((reference) => reference.name === symbol.name)
    .flatMap((reference) => reference.ranges);
}

function sameIncludedSymbol(left: GlslSymbol, right: GlslSymbol): boolean {
  return left.name === right.name && left.kind === right.kind
    && left.declaration.start.line === right.declaration.start.line
    && left.declaration.start.character === right.declaration.start.character;
}

function deduplicateLocations(locations: Location[]): Location[] {
  const unique = new Map<string, Location>();
  for (const location of locations) {
    const { start, end } = location.range;
    unique.set(`${location.uri}:${start.line}:${start.character}:${end.line}:${end.character}`, location);
  }
  return [...unique.values()];
}

/** GLSL names the components of a vector three interchangeable ways. */
const GLSL_SWIZZLE_SETS = ["xyzw", "rgba", "stpq"] as const;

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
  includes: readonly GlslAnalysisDocument[],
  uri: string,
): CompletionItem[] {
  const resolved = resolveGlslExpressionType({ uri, source, stage: environment.stage, position, expression }, {
    includes,
    variableType: (name) => environmentTypeName(name, source, environment),
    functionType: (name) => environmentFunctionType(name, source, environment),
  });
  if (!resolved) {
    return [];
  }
  const vector = resolved.vector;
  if (vector) {
    // Includes whatever valid selection is being typed, so a deliberate
    // `uv.xyx` completes instead of closing the popup on no match.
    return swizzleCompletions(vector.size, GLSL_SWIZZLE_SETS, memberSelectionAt(source, position))
      .map((selection, index) => ({
        label: selection,
        kind: CompletionItemKind.Field,
        sortText: index.toString().padStart(4, "0"),
        detail: selection.length === 1 ? vector.componentType : glslVectorTypeName(vector.componentType, selection.length),
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
  source: string,
  environment: ShaderAuthoringEnvironment,
): string | undefined {
  const uniform = environment.customUniforms.find((item) => item.name === name);
  if (uniform) {
    return uniform.type;
  }
  const documented = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === name
    && item.languages.includes("glsl")
    && (!item.stages || item.stages.includes(environment.stage)));
  return documented?.glslType
    ?? visibleIntrinsics(source, environment.stage).find((item) => item.kind === "variable" && item.name === name)?.returnType;
}

function completionFromDoc(name: string, detail: string | undefined, description: string): CompletionItem {
  return { label: name, kind: CompletionItemKind.Variable, detail, documentation: markdownDocumentation(description) };
}

function markdownDocumentation(description: string) {
  return { kind: MarkupKind.Markdown, value: description } as const;
}

function markdownHover(signature: string, description: string): Hover {
  return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`glsl\n${signature}\n\`\`\`\n\n${description}` } };
}

function completionKind(symbol: GlslSymbol): CompletionItemKind {
  return symbol.kind === "function" ? CompletionItemKind.Function
    : symbol.kind === "type" ? CompletionItemKind.Struct
      : symbol.kind === "field" ? CompletionItemKind.Field
        : CompletionItemKind.Variable;
}

function documentSymbolKind(symbol: GlslSymbol): SymbolKind {
  return symbol.kind === "function" ? SymbolKind.Function
    : symbol.kind === "type" ? SymbolKind.Struct
      : symbol.kind === "field" ? SymbolKind.Field
        : SymbolKind.Variable;
}

function vertexHookFeature(analysis: GlslAnalysisDocument, symbol: GlslSymbol): GlslVertexHookFeature | undefined {
  const scope = symbol.kind === "function"
    ? analysis.scopes.find((item) => (
      item.kind === "function"
      && item.name === "mainVertex"
      && rangeContains(symbol.definition, item.range)
    ))
    : analysis.scopes.find((item) => item.id === symbol.scopeId && item.kind === "function" && item.name === "mainVertex");
  if (!scope) {
    return undefined;
  }
  const parameters = scope.symbolIds
    .map((id) => analysis.symbols.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is GlslSymbol => candidate?.kind === "parameter");
  const functionSymbol = analysis.symbols.find((candidate) => (
    candidate.kind === "function"
    && candidate.name === "mainVertex"
    && candidate.typeName === "void"
    && candidate.signature === "void mainVertex(vec3, vec3, vec2)"
    && rangeContains(candidate.definition, scope.range)
  ));
  const definitionText = sourceForRange(analysis.source, functionSymbol?.definition);
  if (
    !functionSymbol
    || parameters.length !== 3
    || parameters[0]?.typeName !== "vec3"
    || parameters[1]?.typeName !== "vec3"
    || parameters[2]?.typeName !== "vec2"
    || !/\bvoid\s+mainVertex\s*\(\s*inout\s+vec3\b[\s\S]*,\s*inout\s+vec3\b[\s\S]*,\s*inout\s+vec2\b/.test(definitionText)
  ) {
    return undefined;
  }
  const functionFeature = GLSL_VERTEX_HOOK_FEATURES[0];
  if (symbol.id === functionSymbol.id && functionFeature) {
    return {
      ...functionFeature,
      signature: `void mainVertex(inout vec3 ${parameters[0].name}, inout vec3 ${parameters[1].name}, inout vec2 ${parameters[2].name})`,
    };
  }
  const parameterIndex = parameters.findIndex((parameter) => parameter.id === symbol.id);
  const role = GLSL_VERTEX_HOOK_FEATURES[parameterIndex + 1];
  const parameter = parameters[parameterIndex];
  return role && parameter
    ? { ...role, name: parameter.name, signature: `inout ${parameter.typeName} ${parameter.name}` }
    : undefined;
}

interface GlslMainImageFeature {
  readonly signature: string;
  readonly description: string;
}

function mainImageFeature(analysis: GlslAnalysisDocument, symbol: GlslSymbol): GlslMainImageFeature | undefined {
  const scope = symbol.kind === "function"
    ? analysis.scopes.find((item) => (
      item.kind === "function"
      && item.name === "mainImage"
      && rangeContains(symbol.definition, item.range)
    ))
    : analysis.scopes.find((item) => item.id === symbol.scopeId && item.kind === "function" && item.name === "mainImage");
  if (!scope) {
    return undefined;
  }
  const parameters = scope.symbolIds
    .map((id) => analysis.symbols.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is GlslSymbol => candidate?.kind === "parameter");
  const [output, coordinate] = parameters;
  const functionSymbol = analysis.symbols.find((candidate) => (
    candidate.kind === "function"
    && candidate.name === "mainImage"
    && candidate.typeName === "void"
    && candidate.signature === "void mainImage(vec4, vec2)"
    && rangeContains(candidate.definition, scope.range)
  ));
  const definitionText = sourceForRange(analysis.source, functionSymbol?.definition);
  if (
    !functionSymbol
    || parameters.length !== 2
    || output?.typeName !== "vec4"
    || coordinate?.typeName !== "vec2"
    || !/\bvoid\s+mainImage\s*\(\s*out\s+vec4\b[\s\S]*,\s*(?:in\s+)?vec2\b/.test(definitionText)
  ) {
    return undefined;
  }
  if (symbol.id === functionSymbol.id) {
    return {
      signature: `void mainImage(out vec4 ${output.name}, in vec2 ${coordinate.name})`,
      description: GLSL_MAIN_IMAGE_DESCRIPTION,
    };
  }
  if (symbol.id === output.id) {
    return { signature: `out vec4 ${output.name}`, description: GLSL_MAIN_IMAGE_OUTPUT_DESCRIPTION };
  }
  return symbol.id === coordinate.id
    ? { signature: `in vec2 ${coordinate.name}`, description: GLSL_MAIN_IMAGE_COORDINATE_DESCRIPTION }
    : undefined;
}

function rangeContains(outer: import("vscode-languageserver-protocol").Range, inner: import("vscode-languageserver-protocol").Range): boolean {
  return comparePosition(outer.start, inner.start) <= 0 && comparePosition(outer.end, inner.end) >= 0;
}

function comparePosition(left: Position, right: Position): number {
  return left.line === right.line ? left.character - right.character : left.line - right.line;
}

function sourceForRange(source: string, range: import("vscode-languageserver-protocol").Range | undefined): string {
  if (!range) {
    return "";
  }
  const lines = source.split("\n");
  return lines.slice(range.start.line, range.end.line + 1).map((line, index, selected) => (
    index === 0 && index === selected.length - 1
      ? line.slice(range.start.character, range.end.character)
      : index === 0
        ? line.slice(range.start.character)
        : index === selected.length - 1
          ? line.slice(0, range.end.character)
          : line
  )).join("\n");
}

function visibleIntrinsics(source: string, stage: ShaderAuthoringEnvironment["stage"]) {
  const version = glslVersion(source);
  const glsl = glslStage(stage);
  return GLSL_INTRINSICS.filter((item) => item.minVersion <= version
    && item.maxVersion >= version
    && item.stages.includes(glsl));
}

function glslVersion(source: string): 100 | 300 {
  return /^\s*#version\s+100\b/m.test(source) ? 100 : 300;
}
function glslStage(stage: ShaderAuthoringEnvironment["stage"]): "fragment" | "vertex" {
  return stage === "vertex" ? "vertex" : "fragment";
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

/**
 * The innermost call whose argument list holds the cursor and the argument
 * index there. Comments are skipped and commas count only at the call's own
 * nesting level; a `;` or brace ends any call.
 */
function callAt(source: string, position: Position): { name: string; parameter: number } | undefined {
  const lines = source.split("\n");
  if (lines[position.line] === undefined) {
    return undefined;
  }
  const offset = lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
  const prefix = source.slice(0, offset);
  let frames: { name?: string; commas: number; close: ")" | "]" }[] = [];
  let lastIdentifier: string | undefined;
  for (let index = 0; index < prefix.length; index++) {
    const char = prefix[index]!;
    if (prefix.startsWith("//", index)) {
      const end = prefix.indexOf("\n", index);
      index = end === -1 ? prefix.length : end;
      continue;
    }
    if (prefix.startsWith("/*", index)) {
      const end = prefix.indexOf("*/", index + 2);
      index = end === -1 ? prefix.length : end + 1;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(prefix.slice(index))?.[0];
    if (identifier && !/[A-Za-z0-9_]/.test(prefix[index - 1] ?? "")) {
      lastIdentifier = identifier;
      index += identifier.length - 1;
      continue;
    }
    if (/\s/.test(char)) {
      continue;
    }
    if (char === "(") {
      frames.push({ ...(lastIdentifier ? { name: lastIdentifier } : {}), commas: 0, close: ")" });
    } else if (char === "[") {
      frames.push({ commas: 0, close: "]" });
    } else if (char === ")" || char === "]") {
      const open = frames.map((frame) => frame.close).lastIndexOf(char);
      if (open >= 0) {
        frames = frames.slice(0, open);
      }
    } else if (char === ",") {
      const frame = frames[frames.length - 1];
      if (frame) {
        frame.commas += 1;
      }
    } else if (char === ";" || char === "{" || char === "}") {
      frames = [];
    }
    lastIdentifier = undefined;
  }
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index]!;
    if (frame.name !== undefined) {
      return GLSL_CALL_KEYWORDS.has(frame.name) ? undefined : { name: frame.name, parameter: frame.commas };
    }
  }
  return undefined;
}

/** Keywords that open a parenthesized group rather than a call. */
const GLSL_CALL_KEYWORDS = new Set(["if", "for", "while", "switch", "return"]);

function signatureArity(label: string): number {
  const inside = label.slice(label.indexOf("(") + 1, label.lastIndexOf(")")).trim();
  return inside === "" || inside === "void" ? 0 : inside.split(",").length;
}

/** Return type of a function the document does not declare: generated vertex samplers and intrinsics. */
function environmentFunctionType(name: string, source: string, environment: ShaderAuthoringEnvironment): string | undefined {
  const helper = vertexSamplerHelpers(environment).find((item) => item.name === name);
  if (helper) {
    return helper.signature.slice(0, helper.signature.indexOf(" "));
  }
  return visibleIntrinsics(source, environment.stage).find((item) => item.kind === "function" && item.name === name)?.returnType;
}

/** Start of a member selection (`owner.member`) the cursor is on, if any. */
function memberSelectionStart(source: string, position: Position): Position | undefined {
  const line = source.split("\n")[position.line];
  if (line === undefined) {
    return undefined;
  }
  let start = position.character;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1] ?? "")) {
    start -= 1;
  }
  let dot = start - 1;
  while (dot >= 0 && /\s/.test(line[dot] ?? "")) {
    dot -= 1;
  }
  return line[dot] === "." && !/^\s*#/.test(line) ? { line: position.line, character: start } : undefined;
}

/** A member selection hovers by its owner's type, and not at all when that type is unknown. */
function memberHover(
  member: string,
  start: Position,
  source: string,
  environment: ShaderAuthoringEnvironment,
  includes: readonly GlslAnalysisDocument[],
  uri: string,
): Hover | null {
  const access = findMemberAccess(source, start);
  const resolved = access && resolveGlslExpressionType({ uri, source, stage: environment.stage, position: start, expression: access.expression }, {
    includes,
    variableType: (name) => environmentTypeName(name, source, environment),
    functionType: (name) => environmentFunctionType(name, source, environment),
  });
  if (!access || !resolved) {
    return null;
  }
  const vector = resolved.vector;
  if (vector) {
    const set = GLSL_SWIZZLE_SETS.find((candidate) => [...member].every((component) => candidate.slice(0, vector.size).includes(component)));
    const type = member.length === 1 ? vector.componentType : glslVectorTypeName(vector.componentType, member.length);
    return set && member.length <= 4 && type
      ? markdownHover(`${type} ${member}`, `Component selection on \`${access.expression}\`.`)
      : null;
  }
  const field = resolved.fields?.find((candidate) => candidate.name === member);
  return field ? markdownHover(`${field.type} ${member}`, `Field of \`${resolved.name}\`.`) : null;
}

function zeroRange() {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
