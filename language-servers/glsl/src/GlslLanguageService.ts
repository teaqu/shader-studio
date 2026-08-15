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
  type Position,
  type SignatureHelp,
} from "vscode-languageserver-protocol";
import {
  DocumentStore,
  VirtualFileSystem,
  createLiteralColorPresentations,
  findLiteralConstructorColors,
  type ColorPresentationParams,
  type DocumentParams,
  type DocumentPositionParams,
  type LanguageService,
  type ServerCapabilities,
  type ShaderDocumentSnapshot,
} from "@shader-studio/language-server-core";
import {
  SHADER_STUDIO_SYMBOL_DOCS,
  buildGlslAuthoringPreamble,
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "@shader-studio/types";
import { parseGlslDocument, symbolAtPosition, type GlslAnalysisDocument, type GlslSymbol } from "@shader-studio/glsl-analysis";
import { GLSL_INTRINSICS, findGlslIntrinsics } from "./intrinsics.js";

const CAPABILITIES: ServerCapabilities = {
  completion: true,
  hover: true,
  definition: true,
  signatureHelp: true,
  documentSymbols: true,
  diagnostics: true,
  documentColors: true,
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
    this.files.replaceEnvironment(environment.virtualFiles);
    this.includeAnalyses.set(environment.documentUri, environment.virtualFiles.map((file) => (
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
    const items = new Map<string, CompletionItem>();
    for (const symbol of state.analysis.symbols) {
      items.set(symbol.name, { label: symbol.name, kind: completionKind(symbol), detail: symbol.signature ?? symbol.typeName });
    }
    for (const analysis of this.includeAnalyses.get(params.document.uri) ?? []) {
      for (const symbol of analysis.symbols) {
        items.set(symbol.name, { label: symbol.name, kind: completionKind(symbol), detail: symbol.signature ?? symbol.typeName });
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
    const word = wordAt(state.document.text, params.position);
    if (!word) {
      return null;
    }
    const userSymbol = symbolAtPosition(state.analysis, params.position)
      ?? state.analysis.symbols.find((symbol) => symbol.name === word);
    if (userSymbol) {
      return markdownHover(userSymbol.signature ?? `${userSymbol.typeName ?? userSymbol.kind} ${userSymbol.name}`, "Declared in this shader.");
    }
    const included = (this.includeAnalyses.get(params.document.uri) ?? []).flatMap((analysis) => analysis.symbols).find((symbol) => symbol.name === word);
    if (included) {
      return markdownHover(included.signature ?? `${included.typeName ?? included.kind} ${included.name}`, "Declared in an included shader file.");
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
    const call = callAt(state.document.text, params.position);
    if (!call) {
      return null;
    }
    const user = state.analysis.symbols.filter((symbol) => symbol.kind === "function" && symbol.name === call.name && symbol.signature);
    const intrinsic = findGlslIntrinsics(call.name, glslVersion(state.document.text), glslStage(state.environment.stage));
    const labels = [...user.map((symbol) => symbol.signature!), ...intrinsic.map((item) => item.signature)];
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

function completionFromDoc(name: string, detail: string | undefined, description: string): CompletionItem {
  return { label: name, kind: CompletionItemKind.Variable, detail, documentation: { kind: MarkupKind.Markdown, value: description } };
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
