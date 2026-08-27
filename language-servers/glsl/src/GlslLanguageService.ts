import {
  CompletionItemKind,
  DiagnosticSeverity,
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
  findLiteralConstructorColors,
  isPositionInComment,
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
  isShaderLanguageReservedTerm,
  isValidShaderIdentifier,
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "@shader-studio/types";
import {
  parseGlslDocument,
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

  async initialize(): Promise<ServerCapabilities> {
    return CAPABILITIES;
  }

  async syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    if (environment.languageId !== "glsl" || !this.store.syncEnvironment(environment)) {
      return;
    }
    const contextFiles = environment.commonFile
      ? [environment.commonFile, ...environment.virtualFiles]
      : environment.virtualFiles;
    this.files.replaceEnvironment(contextFiles);
    this.includeAnalyses.set(environment.documentUri, contextFiles.map((file) => (
      parseGlslDocument(file.uri, stripIncludeDirectives(file.text), environment.stage)
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
  }

  async completion(params: DocumentPositionParams): Promise<CompletionItem[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    if (isPositionInComment(state.document.text, params.position)) {
      return [];
    }
    const items = new Map<string, CompletionItem>();
    for (const symbol of visibleSymbolsAtPosition(state.analysis, params.position)) {
      const vertexHook = state.environment.stage === "vertex" ? vertexHookFeature(state.analysis, symbol) : undefined;
      const fragmentHook = state.environment.stage === "fragment" ? mainImageFeature(state.analysis, symbol) : undefined;
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
      if (!doc.languages.includes("glsl") || (doc.stages && !doc.stages.includes(state.environment.stage))) {
        continue;
      }
      items.set(doc.name, completionFromDoc(doc.name, doc.glslType, doc.description));
    }
    for (const uniform of state.environment.customUniforms) {
      items.set(uniform.name, completionFromDoc(uniform.name, uniform.type, "Shader Studio custom uniform."));
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
      return [];
    }
    const ranges = params.includeDeclaration
      ? [symbol.declaration, ...symbol.references]
      : symbol.references;
    return orderedRanges(ranges).map((range) => ({ uri: params.document.uri, range }));
  }

  async documentHighlights(params: DocumentPositionParams): Promise<DocumentHighlight[]> {
    const state = this.current(params);
    const symbol = state ? symbolAtPosition(state.analysis, params.position) : null;
    if (!symbol) {
      return [];
    }
    return [
      { range: symbol.declaration, kind: DocumentHighlightKind.Write },
      ...orderedRanges(symbol.references).map((range) => ({ range, kind: DocumentHighlightKind.Read })),
    ];
  }

  async rename(params: RenameParams): Promise<WorkspaceEdit | null> {
    const state = this.current(params);
    // symbolAtPosition only resolves symbols declared in this document, so
    // include-provided and built-in names decline instead of renaming by name.
    const symbol = state ? symbolAtPosition(state.analysis, params.position) : null;
    if (!state || !symbol || !isRenameableName(params.newName) || this.nameIsTaken(state, params)) {
      return null;
    }
    const edits = orderedRanges([symbol.declaration, ...symbol.references])
      .map((range) => ({ range, newText: params.newName }));
    return { changes: { [params.document.uri]: edits } };
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
    diagnostics.push(...includeDiagnostics(state.document.uri, state.document.text, this.files));
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
    return this.store.isCurrent(params.document) ? createLiteralColorPresentations("glsl", params.color, params.range) : [];
  }

  async dispose(): Promise<void> {
    this.analyses.clear();
    this.includeAnalyses.clear();
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

  private rebuild(uri: string): void {
    const document = this.store.getDocument(uri);
    const environment = this.store.getEnvironment(uri);
    if (!document || !environment) {
      return;
    }
    // Build it here so authoring generation stays continuously exercised and validated.
    buildGlslAuthoringPreamble(environment);
    this.analyses.set(uri, parseGlslDocument(uri, stripIncludeDirectives(document.text), environment.stage));
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

function stripIncludeDirectives(source: string): string {
  return source.replace(/^\s*#include\s+["<][^">]+[">].*$/gm, "");
}

function includeDiagnostics(uri: string, source: string, files: VirtualFileSystem): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = source.split("\n");
  lines.forEach((line, lineNumber) => {
    const match = line.match(/^\s*#include\s+["<]([^">]+)[">]/);
    if (!match?.[1]) {
      return;
    }
    const resolved = files.resolve(uri, match[1]);
    const range = { start: { line: lineNumber, character: 0 }, end: { line: lineNumber, character: line.length } };
    if (!resolved) {
      diagnostics.push({ range, severity: DiagnosticSeverity.Error, source: "shader-studio-glsl-ls", code: "include-outside-roots", message: `Include escapes the shader workspace: ${match[1]}` });
    } else if (!files.read(resolved)) {
      diagnostics.push({ range, severity: DiagnosticSeverity.Error, source: "shader-studio-glsl-ls", code: "include-not-found", message: `Include not found: ${match[1]}` });
    } else {
      files.trackDependency(uri, resolved);
    }
  });
  return diagnostics;
}

function zeroRange() {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
