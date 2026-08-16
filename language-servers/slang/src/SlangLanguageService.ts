import {
  CompletionItemKind,
  DiagnosticSeverity,
  MarkupKind,
  SymbolKind,
  type CompletionItem,
  type Diagnostic,
  type DocumentSymbol,
  type Hover,
  type Location,
  type Range,
  type SignatureHelp,
} from "vscode-languageserver-protocol";
import {
  DocumentStore,
  createLiteralColorPresentations,
  findLiteralConstructorColors,
  isPositionInComment,
  type ColorPresentationParams,
  type DocumentParams,
  type DocumentPositionParams,
  type LanguageService,
  type ServerCapabilities,
  type ShaderDocumentSnapshot,
} from "@shader-studio/language-server-core";
import {
  SHADER_STUDIO_SYMBOL_DOCS,
  buildSlangAuthoringModule,
  deriveSlangChannelGeneratedIdentifiers,
  isValidShaderIdentifier,
  resolveAuthoringChannelBindings,
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "@shader-studio/types";
import type {
  SlangDiagnostic,
  SlangCompilerGlobalSession,
  SlangDocumentSymbol,
  SlangLanguageServer,
  SlangLanguageServerModule,
  SlangList,
} from "./slangLanguageServerTypes.js";
import { SLANG_INTRINSICS, type SlangIntrinsic } from "./intrinsics.js";
import { SLANG_COMPUTE_FEATURES, type SlangComputeFeature } from "./computeFeatures.js";
import { SLANG_VERTEX_HOOK_FEATURES, type SlangVertexHookFeature } from "./vertexHook.js";
import { SLANG_MAIN_IMAGE_COORDINATE_DESCRIPTION, SLANG_MAIN_IMAGE_DESCRIPTION } from "./fragmentHook.js";

const CAPABILITIES: ServerCapabilities = {
  completion: true,
  hover: true,
  definition: true,
  signatureHelp: true,
  documentSymbols: true,
  diagnostics: true,
  documentColors: true,
};

export class SlangLanguageService implements LanguageService {
  private readonly store = new DocumentStore();
  private readonly server: SlangLanguageServer;
  private readonly lineOffsets = new Map<string, number>();
  private readonly opened = new Set<string>();
  private readonly virtualOpened = new Set<string>();
  private compilerGlobalSession: SlangCompilerGlobalSession | undefined;
  private compilerTarget: number | undefined;

  constructor(private readonly module: SlangLanguageServerModule) {
    const server = module.createLanguageServer();
    if (!server) {
      throw new Error("Slang createLanguageServer returned null");
    }
    this.server = server;
  }

  async initialize(): Promise<ServerCapabilities> {
    return CAPABILITIES;
  }

  async syncEnvironment(environment: ShaderAuthoringEnvironment): Promise<void> {
    if (environment.languageId !== "slang" || !this.store.syncEnvironment(environment)) {
      return;
    }
    for (const file of environment.virtualFiles) {
      if (this.virtualOpened.has(file.uri)) {
        this.server.didCloseTextDocument(file.uri);
      }
      this.server.didOpenTextDocument(file.uri, file.text);
      this.virtualOpened.add(file.uri);
    }
    this.reopen(environment.documentUri);
  }

  async openDocument(document: ShaderDocumentSnapshot): Promise<void> {
    if (document.languageId !== "slang" || !this.store.open(document)) {
      return;
    }
    this.reopen(document.uri);
  }

  async changeDocument(document: ShaderDocumentSnapshot): Promise<void> {
    if (document.languageId !== "slang" || !this.store.change(document)) {
      return;
    }
    this.reopen(document.uri);
  }

  async closeDocument(uri: string): Promise<void> {
    if (this.opened.delete(uri)) {
      this.server.didCloseTextDocument(uri);
    }
    this.lineOffsets.delete(uri);
    this.store.close(uri);
  }

  async completion(params: DocumentPositionParams): Promise<CompletionItem[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const documentedFunctions = documentedSlangFunctions(state.environment);
    const computeFeatures = state.environment.stage === "compute" ? SLANG_COMPUTE_FEATURES : [];
    const vertexFeatures = state.environment.stage === "vertex" ? SLANG_VERTEX_HOOK_FEATURES : [];
    const official = consumeList(this.server.completion(params.document.uri, shiftedPosition(params.position, state.offset), {
      triggerKind: 1,
      triggerCharacter: "",
    }), (item) => {
      const editRange = item.textEdit ? userRange(item.textEdit.range, state.offset, state.document.text) : undefined;
      const intrinsic = documentedFunctions.find((entry) => entry.name === item.label);
      const computeFeature = computeFeatures.find((entry) => entry.name === item.label);
      const fragmentFeature = state.environment.stage === "fragment"
        ? mainImageCompletionFeature(state.document.text, params.position, item.label)
        : undefined;
      return {
        label: item.label,
        kind: item.kind as CompletionItemKind,
        detail: fragmentFeature?.signature ?? item.detail,
        documentation: computeFeature
          ? computeFeatureMarkup(computeFeature)
          : fragmentFeature
            ? contractMarkup(fragmentFeature.signature, fragmentFeature.description)
            : item.documentation ? markup(item.documentation) : intrinsic ? intrinsicMarkup(intrinsic) : undefined,
        textEdit: item.textEdit && editRange ? { range: editRange, newText: item.textEdit.text } : undefined,
        data: item.data,
      };
    });
    const items = new Map<string, CompletionItem>(official.map((item) => [`${item.label}:${item.detail ?? ""}`, item]));
    const officialLabels = new Set(official.map((item) => item.label));
    for (const intrinsic of documentedFunctions) {
      if (officialLabels.has(intrinsic.name)) {
        continue;
      }
      const item = completionForIntrinsic(intrinsic);
      items.set(`${item.label}:${item.detail}`, item);
    }
    for (const feature of computeFeatures) {
      if (officialLabels.has(feature.name)) {
        continue;
      }
      items.set(`${feature.name}:${feature.syntax}`, {
        label: feature.name,
        kind: feature.kind === "attribute" ? CompletionItemKind.Keyword : CompletionItemKind.Variable,
        detail: feature.syntax,
        documentation: computeFeatureMarkup(feature),
      });
    }
    for (const doc of SHADER_STUDIO_SYMBOL_DOCS) {
      if (!doc.languages.includes("slang") || (doc.stages && !doc.stages.includes(state.environment.stage))) {
        continue;
      }
      items.set(`${doc.name}:${doc.slangType}`, {
        label: doc.name,
        kind: CompletionItemKind.Variable,
        detail: doc.slangType,
        documentation: { kind: MarkupKind.Markdown, value: doc.description },
      });
    }
    for (const uniform of state.environment.customUniforms) {
      items.set(`${uniform.name}:${uniform.type}`, { label: uniform.name, kind: CompletionItemKind.Variable, detail: slangType(uniform.type) });
    }
    for (const resource of state.environment.resources) {
      items.set(`${resource.name}:${resource.kind}`, { label: resource.name, kind: CompletionItemKind.Variable, detail: resource.kind });
    }
    for (const declaration of findSlangDeclarations(state.document.text)) {
      const fragmentFeature = state.environment.stage === "fragment"
        ? mainImageCompletionFeature(state.document.text, params.position, declaration.name)
        : undefined;
      items.set(`${declaration.name}:${declaration.detail}`, {
        label: declaration.name,
        kind: declaration.kind === SymbolKind.Function ? CompletionItemKind.Function : CompletionItemKind.Struct,
        detail: fragmentFeature?.signature ?? declaration.detail,
        documentation: fragmentFeature ? contractMarkup(fragmentFeature.signature, fragmentFeature.description) : undefined,
      });
    }
    if (state.environment.stage === "fragment") {
      const coordinate = mainImageCoordinateCompletion(state.document.text, params.position);
      if (coordinate) {
        items.set(`${coordinate.name}:${coordinate.feature.signature}`, {
          label: coordinate.name,
          kind: CompletionItemKind.Variable,
          detail: coordinate.feature.signature,
          documentation: contractMarkup(coordinate.feature.signature, coordinate.feature.description),
        });
      }
    }
    for (const feature of vertexFeatures) {
      if (feature.kind === "parameter" && !hasCanonicalVertexHookParameter(state.document.text, feature)) {
        continue;
      }
      for (const [key, item] of items) {
        if (item.label === feature.name) {
          items.delete(key);
        }
      }
      items.set(`${feature.name}:${feature.signature}`, {
        label: feature.name,
        kind: feature.kind === "function" ? CompletionItemKind.Function : CompletionItemKind.Variable,
        detail: feature.signature,
        documentation: vertexHookMarkup(feature),
      });
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
    const doc = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === word && item.languages.includes("slang"));
    if (doc) {
      return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${doc.slangType} ${doc.name}\n\`\`\`\n\n${doc.description}` } };
    }
    const uniform = state.environment.customUniforms.find((item) => item.name === word);
    if (uniform) {
      return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${slangType(uniform.type)} ${uniform.name}\n\`\`\`\n\nShader Studio custom uniform.` } };
    }
    const intrinsic = word ? documentedSlangFunctions(state.environment).find((item) => item.name === word) : undefined;
    if (intrinsic) {
      return { contents: intrinsicMarkup(intrinsic) };
    }
    const computeFeature = state.environment.stage === "compute"
      ? SLANG_COMPUTE_FEATURES.find((item) => item.name === word)
      : undefined;
    if (computeFeature) {
      return { contents: computeFeatureMarkup(computeFeature) };
    }
    const vertexFeature = state.environment.stage === "vertex" && word
      ? vertexHookFeatureAt(state.document.text, params.position, word)
      : undefined;
    if (vertexFeature) {
      return { contents: vertexHookMarkup(vertexFeature) };
    }
    const fragmentFeature = state.environment.stage === "fragment" && word
      ? mainImageFeatureAt(state.document.text, params.position, word)
      : undefined;
    if (fragmentFeature) {
      return { contents: mainImageMarkup(fragmentFeature, params.document.uri) };
    }
    const local = findSlangDeclarations(state.document.text).find((item) => item.name === word);
    const result = this.server.hover(params.document.uri, shiftedPosition(params.position, state.offset));
    if (result) {
      const contents = markup(result.contents);
      if (/Defined in [0-9a-f]{32,64}\(\d+\)/i.test(contents.value)) {
        const line = local?.selectionRange.start.line !== undefined
          ? local.selectionRange.start.line + 1
          : currentDocumentDefinitionLine(
            this.server,
            params.document.uri,
            shiftedPosition(params.position, state.offset),
            state.offset,
            state.document.text,
          ) ?? generatedLocalDefinitionLine(contents.value, word, state.offset, state.document.text);
        if (line !== undefined) {
          contents.value = localSourceHover(contents.value, params.document.uri, line);
        }
      }
      return { contents, range: userRange(result.range, state.offset, state.document.text) };
    }
    return local ? { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${local.detail}\n\`\`\`` }, range: local.selectionRange } : null;
  }

  async definition(params: DocumentPositionParams): Promise<Location[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.server.gotoDefinition(params.document.uri, shiftedPosition(params.position, state.offset)), (item) => {
      const range = item.uri === params.document.uri ? userRange(item.range, state.offset, state.document.text) : item.range;
      return range ? { uri: item.uri, range } : undefined;
    }).filter((item): item is Location => item !== undefined);
    if (official.length > 0) {
      return official;
    }
    const word = wordAt(state.document.text, params.position);
    const local = findSlangDeclarations(state.document.text).find((item) => item.name === word);
    return local ? [{ uri: params.document.uri, range: local.selectionRange }] : [];
  }

  async signatureHelp(params: DocumentPositionParams): Promise<SignatureHelp | null> {
    const state = this.current(params);
    if (!state) {
      return null;
    }
    const result = this.server.signatureHelp(params.document.uri, shiftedPosition(params.position, state.offset));
    if (result) {
      const signatures = consumeList(result.signatures, (signature) => ({
        label: signature.label,
        documentation: markup(signature.documentation),
        parameters: consumeList(signature.parameters, (parameter) => ({ label: parameter.label, documentation: markup(parameter.documentation) })),
      }));
      return { signatures, activeSignature: result.activeSignature, activeParameter: result.activeParameter };
    }
    const call = callAt(state.document.text, params.position);
    if (!call) {
      return null;
    }
    const signatures = findSlangDeclarations(state.document.text).filter((item) => item.kind === SymbolKind.Function && item.name === call.name);
    const intrinsics = documentedSlangFunctions(state.environment).filter((item) => item.name === call.name);
    const labels = [...signatures.map((item) => item.detail), ...intrinsics.flatMap((item) => item.signatures)];
    return labels.length > 0 ? { signatures: labels.map((label) => ({ label })), activeSignature: 0, activeParameter: call.parameter } : null;
  }

  async documentSymbols(params: DocumentParams): Promise<DocumentSymbol[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.server.documentSymbol(params.document.uri), (item) => convertDocumentSymbol(item, state.offset, state.document.text))
      .filter((item): item is DocumentSymbol => item !== undefined);
    return official.length > 0 ? official : findSlangDeclarations(state.document.text).map((item) => ({
      name: item.name,
      detail: item.detail,
      kind: item.kind,
      range: item.range,
      selectionRange: item.selectionRange,
    }));
  }

  async diagnostics(params: DocumentParams): Promise<Diagnostic[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.server.getDiagnostics(params.document.uri), (item) => convertDiagnostic(item, state.offset, state.document.text))
      .filter((item): item is Diagnostic => item !== undefined);
    const environment = validateShaderAuthoringEnvironment(state.environment).map((issue) => ({
      range: zeroRange(),
      severity: DiagnosticSeverity.Warning,
      source: "shader-studio-slang-ls",
      code: issue.code,
      message: issue.message,
    }));
    const compiler = official.length === 0 ? this.compilerDiagnostics(state) : [];
    return [...official, ...compiler, ...environment];
  }

  async documentColors(params: DocumentParams) {
    const state = this.current(params);
    return state ? findLiteralConstructorColors(state.document.text, ["float3", "float4"]) : [];
  }

  async colorPresentations(params: ColorPresentationParams) {
    return this.store.isCurrent(params.document) ? createLiteralColorPresentations("slang", params.color, params.range) : [];
  }

  async dispose(): Promise<void> {
    for (const uri of this.opened) {
      this.server.didCloseTextDocument(uri);
    }
    for (const uri of this.virtualOpened) {
      this.server.didCloseTextDocument(uri);
    }
    this.opened.clear();
    this.virtualOpened.clear();
    this.compilerGlobalSession?.delete?.();
    this.compilerGlobalSession = undefined;
    this.compilerTarget = undefined;
    this.server.delete?.();
  }

  private reopen(uri: string): void {
    const document = this.store.getDocument(uri);
    const environment = this.store.getEnvironment(uri);
    if (!document || !environment) {
      return;
    }
    if (this.opened.has(uri)) {
      this.server.didCloseTextDocument(uri);
    }
    const prelude = buildSlangAuthoringModule(environment).text;
    const offset = prelude ? prelude.split("\n").length : 0;
    this.lineOffsets.set(uri, offset);
    this.server.didOpenTextDocument(uri, prelude ? `${prelude}\n${document.text}` : document.text);
    this.opened.add(uri);
  }

  private current(params: DocumentParams) {
    if (!this.store.isCurrent(params.document)) {
      return undefined;
    }
    const document = this.store.getDocument(params.document.uri);
    const environment = this.store.getEnvironment(params.document.uri);
    const offset = this.lineOffsets.get(params.document.uri);
    return document && environment && offset !== undefined ? { document, environment, offset } : undefined;
  }

  private compilerDiagnostics(state: NonNullable<ReturnType<SlangLanguageService["current"]>>): Diagnostic[] {
    const compiler = this.compiler();
    if (!compiler) {
      return [];
    }
    const session = compiler.globalSession.createSession(compiler.target);
    if (!session) {
      return [];
    }
    try {
      for (const file of state.environment.virtualFiles) {
        const dependency = session.loadModuleFromSource(
          stripEditorImport(file.text),
          moduleName(file.text, file.uri),
          sourcePath(file.uri),
        );
        if (!dependency) {
          return parseCompilerDiagnostics(this.module.getLastError?.().message ?? "", sourcePath(state.document.uri), state.offset, state.document.text);
        }
      }
      const prelude = buildSlangAuthoringModule(state.environment).text;
      const source = prelude ? `${prelude}\n${stripEditorImport(state.document.text)}` : stripEditorImport(state.document.text);
      const compiled = session.loadModuleFromSource(source, moduleName(state.document.text, state.document.uri), sourcePath(state.document.uri));
      if (compiled) {
        compiled.delete?.();
        return [];
      }
      return parseCompilerDiagnostics(this.module.getLastError?.().message ?? "", sourcePath(state.document.uri), state.offset, state.document.text);
    } finally {
      session.delete?.();
    }
  }

  private compiler(): { globalSession: SlangCompilerGlobalSession; target: number } | undefined {
    if (this.compilerGlobalSession && this.compilerTarget !== undefined) {
      return { globalSession: this.compilerGlobalSession, target: this.compilerTarget };
    }
    if (!this.module.createGlobalSession || !this.module.getCompileTargets) {
      return undefined;
    }
    const globalSession = this.module.createGlobalSession();
    if (!globalSession) {
      return undefined;
    }
    const targets = consumeCompilerTargets(this.module.getCompileTargets());
    const target = targets.find((item) => /wgsl/i.test(item.name))?.value;
    if (target === undefined) {
      globalSession.delete?.();
      return undefined;
    }
    this.compilerGlobalSession = globalSession;
    this.compilerTarget = target;
    return { globalSession, target };
  }
}

function computeFeatureMarkup(feature: SlangComputeFeature) {
  return { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${feature.syntax}\n\`\`\`\n\n${feature.description}` } as const;
}

function vertexHookMarkup(feature: SlangVertexHookFeature) {
  return contractMarkup(feature.signature, feature.description);
}

function contractMarkup(signature: string, description: string) {
  return { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${signature}\n\`\`\`\n\n${description}` } as const;
}

interface SlangMainImageFeature {
  readonly signature: string;
  readonly description: string;
  readonly line: number;
}

function mainImageMarkup(feature: SlangMainImageFeature, uri: string) {
  const filename = sourcePath(uri).split("/").pop() || "shader.slang";
  const contents = contractMarkup(feature.signature, feature.description);
  return { ...contents, value: `${contents.value}\n\nDefined in ${filename}(${feature.line})` };
}

function mainImageFeatureAt(
  source: string,
  position: { line: number; character: number },
  word: string,
): SlangMainImageFeature | undefined {
  const offset = offsetAtPosition(source, position);
  for (const match of source.matchAll(/\bfloat4\s+(mainImage)\s*\(\s*float2\s+([A-Za-z_]\w*)\s*\)/g)) {
    const parameter = match[2];
    if (!parameter) {
      continue;
    }
    const nameStart = match.index + match[0].indexOf("mainImage");
    if (word === "mainImage" && offset >= nameStart && offset <= nameStart + "mainImage".length) {
      return {
        signature: `float4 mainImage(float2 ${parameter})`,
        description: SLANG_MAIN_IMAGE_DESCRIPTION,
        line: positionAtOffset(source, nameStart).line + 1,
      };
    }
    const bodyStart = source.indexOf("{", match.index + match[0].length);
    const bodyEnd = bodyStart >= 0 ? matchingBrace(source, bodyStart) : -1;
    if (word === parameter && bodyStart >= 0 && bodyEnd >= offset && offset >= match.index) {
      return {
        signature: `float2 ${parameter}`,
        description: SLANG_MAIN_IMAGE_COORDINATE_DESCRIPTION,
        line: positionAtOffset(source, match.index + match[0].lastIndexOf(parameter)).line + 1,
      };
    }
  }
  return undefined;
}

function mainImageCompletionFeature(
  source: string,
  position: { line: number; character: number },
  label: string,
): SlangMainImageFeature | undefined {
  if (label !== "mainImage") {
    return mainImageFeatureAt(source, position, label);
  }
  const match = source.match(/\bfloat4\s+(mainImage)\s*\(\s*float2\s+([A-Za-z_]\w*)\s*\)/);
  const parameter = match?.[2];
  if (!match || !parameter || match.index === undefined) {
    return undefined;
  }
  const nameStart = match.index + match[0].indexOf("mainImage");
  return {
    signature: `float4 mainImage(float2 ${parameter})`,
    description: SLANG_MAIN_IMAGE_DESCRIPTION,
    line: positionAtOffset(source, nameStart).line + 1,
  };
}

function mainImageCoordinateCompletion(
  source: string,
  position: { line: number; character: number },
): { name: string; feature: SlangMainImageFeature } | undefined {
  const offset = offsetAtPosition(source, position);
  for (const match of source.matchAll(/\bfloat4\s+mainImage\s*\(\s*float2\s+([A-Za-z_]\w*)\s*\)/g)) {
    const name = match[1];
    if (!name) {
      continue;
    }
    const bodyStart = source.indexOf("{", match.index + match[0].length);
    const bodyEnd = bodyStart >= 0 ? matchingBrace(source, bodyStart) : -1;
    if (bodyStart >= 0 && offset >= bodyStart && offset <= bodyEnd) {
      const feature = mainImageFeatureAt(source, position, name);
      return feature ? { name, feature } : undefined;
    }
  }
  return undefined;
}

function offsetAtPosition(source: string, position: { line: number; character: number }): number {
  return source.split("\n").slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
}

function matchingBrace(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}" && --depth === 0) {
      return index;
    }
  }
  return source.length;
}

function hasCanonicalVertexHookParameter(source: string, feature: SlangVertexHookFeature): boolean {
  if (feature.kind !== "parameter") {
    return true;
  }
  return vertexHookParameterLists(source).some((parameters) => parameterListHasFeature(parameters, feature));
}

function parameterListHasFeature(parameters: string, feature: SlangVertexHookFeature): boolean {
  return new RegExp(`\\b${feature.signature.replace(/\s+/g, "\\s+")}\\b`).test(parameters);
}

function vertexHookFeatureAt(
  source: string,
  position: { line: number; character: number },
  word: string,
): SlangVertexHookFeature | undefined {
  const feature = SLANG_VERTEX_HOOK_FEATURES.find((item) => item.name === word);
  if (!feature) {
    return undefined;
  }
  if (feature.kind === "function") {
    return feature;
  }
  const lines = source.split("\n");
  const offset = lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
  return vertexHookParameterMatches(source).some((match) => (
    offset >= match.start && offset <= match.end && parameterListHasFeature(match.parameters, feature)
  )) ? feature : undefined;
}

function vertexHookParameterLists(source: string): string[] {
  return vertexHookParameterMatches(source).map((match) => match.parameters);
}

function vertexHookParameterMatches(source: string): { start: number; end: number; parameters: string }[] {
  return [...source.matchAll(/\bvoid\s+mainVertex\s*\(([^)]*)\)/g)].flatMap((match) => match[1] === undefined
    ? []
    : [{ start: match.index, end: match.index + match[0].length, parameters: match[1] }]);
}

function consumeList<T, U>(list: SlangList<T> | undefined, convert: (value: T) => U): U[] {
  if (!list) {
    return [];
  }
  try {
    const result: U[] = [];
    for (let index = 0; index < list.size(); index++) {
      const item = list.get(index);
      if (item !== undefined) {
        result.push(convert(item));
      }
    }
    return result;
  } finally {
    list.delete?.();
  }
}

function convertDocumentSymbol(item: SlangDocumentSymbol, offset: number, source: string): DocumentSymbol | undefined {
  const range = userRange(item.range, offset, source);
  const selectionRange = userRange(item.selectionRange, offset, source);
  const children = consumeList(item.children, (child) => convertDocumentSymbol(child, offset, source)).filter((child): child is DocumentSymbol => child !== undefined);
  return range && selectionRange ? { name: item.name, detail: item.detail, kind: item.kind as SymbolKind, range, selectionRange, children } : undefined;
}

function convertDiagnostic(item: SlangDiagnostic, offset: number, source: string): Diagnostic | undefined {
  const range = userRange(item.range, offset, source);
  return range ? { code: item.code, range, severity: item.severity as DiagnosticSeverity, message: item.message, source: "shader-studio-slang-ls" } : undefined;
}

function shiftedPosition(position: { line: number; character: number }, lines: number) {
  return { line: position.line + lines, character: position.character };
}
function shiftedRange(range: Range, lines: number): Range {
  return { start: shiftedPosition(range.start, lines), end: shiftedPosition(range.end, lines) };
}
function userRange(range: Range, offset: number, source: string): Range | undefined {
  const shifted = shiftedRange(range, -offset);
  const lines = source.split("\n");
  const valid = (position: { line: number; character: number }) => (
    position.line >= 0
    && position.line < lines.length
    && position.character >= 0
    && position.character <= (lines[position.line]?.length ?? 0)
  );
  return valid(shifted.start) && valid(shifted.end) ? shifted : undefined;
}
function zeroRange(): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

function consumeCompilerTargets(targets: import("./slangLanguageServerTypes.js").SlangCompileTarget[] | SlangList<import("./slangLanguageServerTypes.js").SlangCompileTarget>) {
  return Array.isArray(targets) ? targets : consumeList(targets, (item) => item);
}

function stripEditorImport(source: string): string {
  return source.replace(/^\s*import\s+(?:shader_studio|"shader-studio\.slang")\s*;?.*$/gm, (line) => `//${" ".repeat(Math.max(0, line.length - 2))}`);
}

function sourcePath(uri: string): string {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "file:" ? decodeURIComponent(parsed.pathname) : `/${parsed.pathname || "shader.slang"}`;
  } catch {
    return uri.startsWith("/") ? uri : `/${uri}`;
  }
}

function moduleName(source: string, uri: string): string {
  return source.match(/^\s*module\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/m)?.[1]
    ?? sourcePath(uri).split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_")
    ?? "shader";
}

function parseCompilerDiagnostics(error: string, rootPath: string, offset: number, source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const expression = /error(?:\[([^\]]+)\])?: ([^\n]+)\n\s*--> ([^\n]+):(\d+):(\d+)([\s\S]*?)(?=\n(?:error|fatal error)(?:\[|:)|$)/g;
  for (const match of error.matchAll(expression)) {
    if (match[3] !== rootPath) {
      continue;
    }
    const line = Number(match[4]) - 1 - offset;
    const character = Number(match[5]) - 1;
    const sourceLine = source.split("\n")[line];
    if (line < 0 || sourceLine === undefined || character < 0 || character > sourceLine.length) {
      continue;
    }
    const caretLength = match[6]?.match(/\^+/)?.[0].length ?? 1;
    const detail = match[6]?.match(/\^+\s+([^\n]+)/)?.[1]?.trim();
    diagnostics.push({
      code: match[1],
      range: {
        start: { line, character },
        end: { line, character: Math.min(sourceLine.length, character + caretLength) },
      },
      severity: DiagnosticSeverity.Error,
      source: "shader-studio-slang-compiler",
      message: detail || match[2] || "Slang compilation error",
    });
  }
  return diagnostics;
}
function slangType(type: string) {
  return type === "vec2" ? "float2" : type === "vec3" ? "float3" : type === "vec4" ? "float4" : type;
}
function markup(value: { kind: string; value: string }) {
  return { kind: value.kind === "plaintext" ? MarkupKind.PlainText : MarkupKind.Markdown, value: value.value };
}

function localSourceHover(value: string, uri: string, line: number): string {
  const filename = sourcePath(uri).split("/").pop() || "shader.slang";
  return value.replace(/Defined in [0-9a-f]{32,64}\(\d+\)/gi, `Defined in ${filename}(${line})`);
}

function currentDocumentDefinitionLine(
  server: SlangLanguageServer,
  uri: string,
  position: { line: number; character: number },
  offset: number,
  source: string,
): number | undefined {
  const locations = consumeList(server.gotoDefinition(uri, position), (location) => location);
  const local = locations.find((location) => location.uri === uri);
  const range = local ? userRange(local.range, offset, source) : undefined;
  return range ? range.start.line + 1 : undefined;
}

function generatedLocalDefinitionLine(
  hover: string,
  word: string | undefined,
  offset: number,
  source: string,
): number | undefined {
  const generatedLine = Number(hover.match(/Defined in [0-9a-f]{32,64}\((\d+)\)/i)?.[1]);
  const line = generatedLine - offset;
  const authoredLine = source.split("\n")[line - 1];
  if (!word || !Number.isSafeInteger(line) || line < 1 || authoredLine === undefined) {
    return undefined;
  }
  return new RegExp(`\\b${escapeRegExp(word)}\\b`).test(authoredLine) ? line : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordAt(source: string, position: { line: number; character: number }): string | undefined {
  const line = source.split("\n")[position.line];
  if (line === undefined) {
    return undefined;
  }
  const left = line.slice(0, position.character).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  const right = line.slice(position.character).match(/^[A-Za-z0-9_]*/)?.[0] ?? "";
  return `${left}${right}` || undefined;
}

interface SlangDeclaration {
  name: string;
  detail: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
}

function findSlangDeclarations(source: string): SlangDeclaration[] {
  const declarations: SlangDeclaration[] = [];
  const patterns = [
    { expression: /\bstruct\s+([A-Za-z_]\w*)/g, kind: SymbolKind.Struct },
    { expression: /\b([A-Za-z_]\w*(?:\s*<[^>]+>)?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g, kind: SymbolKind.Function },
  ] as const;
  for (const { expression, kind } of patterns) {
    for (const match of source.matchAll(expression)) {
      const name = kind === SymbolKind.Struct ? match[1] : match[2];
      if (!name || ["if", "for", "while", "switch"].includes(name)) {
        continue;
      }
      const nameOffset = match.index + match[0].indexOf(name);
      const selectionRange = offsetRange(source, nameOffset, nameOffset + name.length);
      declarations.push({
        name,
        kind,
        detail: kind === SymbolKind.Struct ? `struct ${name}` : `${match[1]} ${name}(${match[3] ?? ""})`,
        range: offsetRange(source, match.index, match.index + match[0].length),
        selectionRange,
      });
    }
  }
  return declarations;
}

function offsetRange(source: string, start: number, end: number): Range {
  return { start: positionAtOffset(source, start), end: positionAtOffset(source, end) };
}

function positionAtOffset(source: string, offset: number) {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 };
}

function callAt(source: string, position: { line: number; character: number }): { name: string; parameter: number } | undefined {
  const lines = source.split("\n");
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
        const name = prefix.slice(0, index).match(/([A-Za-z_]\w*)\s*$/)?.[1];
        return name ? { name, parameter: prefix.slice(index + 1).split(",").length - 1 } : undefined;
      }
    }
  }
  return undefined;
}

function documentedSlangFunctions(environment: ShaderAuthoringEnvironment): readonly SlangIntrinsic[] {
  const functions = new Map(SLANG_INTRINSICS.map((item) => [item.name, item]));
  if (environment.stage === "compute") {
    const layered = environment.outputLayers !== undefined && environment.outputLayers > 1;
    functions.set("writeOutput", intrinsic(
      "writeOutput",
      layered
        ? "void writeOutput(uint2 coord, uint layer, float4 color)"
        : "void writeOutput(uint2 coord, float4 color)",
      layered
        ? "Writes a color to one layer of the current compute pass output texture."
        : "Writes a color to the current compute pass output texture.",
    ));
  }
  const bindings = resolveAuthoringChannelBindings(environment.resources)
    .filter(({ resource }) => isValidShaderIdentifier(resource.name));
  const claimedSlots = new Set(bindings.map(({ slot }) => slot));
  for (const binding of bindings) {
    const identifiers = deriveSlangChannelGeneratedIdentifiers(binding);
    if (!identifiers.slotHelper || !identifiers.slotVertexHelper || !identifiers.samplingParameterType) {
      continue;
    }
    const parameter = identifiers.samplingParameterType === "float3" ? "float3 dir" : "float2 uv";
    const coordinates = identifiers.samplingParameterType === "float3"
      ? "a cube-map direction"
      : "normalized UV coordinates; Shader Studio flips the V coordinate to match texture orientation";
    const description = `Samples Shader Studio input channel ${binding.slot} (${binding.resource.name}) using ${coordinates}.`;
    functions.set(identifiers.slotHelper, intrinsic(identifiers.slotHelper, `float4 ${identifiers.slotHelper}(${parameter})`, description));
    functions.set(identifiers.slotVertexHelper, intrinsic(
      identifiers.slotVertexHelper,
      `float4 ${identifiers.slotVertexHelper}(${parameter})`,
      `${description} This vertex-stage variant samples mip level zero.`,
    ));
    if (identifiers.aliasHelper && identifiers.aliasVertexHelper) {
      functions.set(identifiers.aliasHelper, intrinsic(
        identifiers.aliasHelper,
        `float4 ${identifiers.aliasHelper}(${parameter})`,
        `Named sampling helper for Shader Studio input channel ${binding.slot} (${binding.resource.name}), using ${coordinates}.`,
      ));
      functions.set(identifiers.aliasVertexHelper, intrinsic(
        identifiers.aliasVertexHelper,
        `float4 ${identifiers.aliasVertexHelper}(${parameter})`,
        `Named vertex-stage helper for Shader Studio input channel ${binding.slot} (${binding.resource.name}), using ${coordinates}. It samples mip level zero.`,
      ));
    }
  }
  for (let slot = 0; slot < 4; slot++) {
    if (claimedSlots.has(slot)) {
      continue;
    }
    const name = `sampleIChannel${slot}`;
    functions.set(name, intrinsic(
      name,
      `float4 ${name}(float2 uv)`,
      `Samples Shader Studio input channel ${slot}. With no resource assigned to this slot, it returns opaque black.`,
    ));
  }
  return [...functions.values()];
}

function intrinsic(name: string, signature: string, description: string): SlangIntrinsic {
  return { name, signatures: [signature], description };
}

function completionForIntrinsic(intrinsic: SlangIntrinsic): CompletionItem {
  return {
    label: intrinsic.name,
    kind: CompletionItemKind.Function,
    detail: intrinsic.signatures[0],
    documentation: intrinsicMarkup(intrinsic),
  };
}

function intrinsicMarkup(intrinsic: SlangIntrinsic) {
  return {
    kind: MarkupKind.Markdown,
    value: `${intrinsic.signatures.map((signature) => `\`\`\`slang\n${signature}\n\`\`\``).join("\n\n")}\n\n${intrinsic.description}`,
  };
}
