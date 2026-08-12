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
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "@shader-studio/types";
import type {
  SlangDiagnostic,
  SlangDocumentSymbol,
  SlangLanguageServer,
  SlangLanguageServerModule,
  SlangList,
} from "./slangLanguageServerTypes.js";

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

  constructor(module: SlangLanguageServerModule) {
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
    const official = consumeList(this.server.completion(params.document.uri, shiftedPosition(params.position, state.offset), {
      triggerKind: 1,
      triggerCharacter: "",
    }), (item) => ({
      label: item.label,
      kind: item.kind as CompletionItemKind,
      detail: item.detail,
      documentation: item.documentation ? markup(item.documentation) : undefined,
      textEdit: item.textEdit ? { range: shiftedRange(item.textEdit.range, -state.offset), newText: item.textEdit.text } : undefined,
      data: item.data,
    }));
    const items = new Map<string, CompletionItem>(official.map((item) => [`${item.label}:${item.detail ?? ""}`, item]));
    for (const item of SLANG_FALLBACK_COMPLETIONS) {
      items.set(`${item.label}:${item.detail}`, item);
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
      items.set(`${declaration.name}:${declaration.detail}`, {
        label: declaration.name,
        kind: declaration.kind === SymbolKind.Function ? CompletionItemKind.Function : CompletionItemKind.Struct,
        detail: declaration.detail,
      });
    }
    return [...items.values()];
  }

  async hover(params: DocumentPositionParams): Promise<Hover | null> {
    const state = this.current(params);
    if (!state) {
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
    const result = this.server.hover(params.document.uri, shiftedPosition(params.position, state.offset));
    if (result) {
      return { contents: markup(result.contents), range: shiftedRange(result.range, -state.offset) };
    }
    const local = findSlangDeclarations(state.document.text).find((item) => item.name === word);
    return local ? { contents: { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${local.detail}\n\`\`\`` }, range: local.selectionRange } : null;
  }

  async definition(params: DocumentPositionParams): Promise<Location[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.server.gotoDefinition(params.document.uri, shiftedPosition(params.position, state.offset)), (item) => {
      const range = item.uri === params.document.uri ? shiftedRange(item.range, -state.offset) : item.range;
      return range.start.line < 0 ? undefined : { uri: item.uri, range };
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
    return signatures.length > 0 ? { signatures: signatures.map((item) => ({ label: item.detail })), activeSignature: 0, activeParameter: call.parameter } : null;
  }

  async documentSymbols(params: DocumentParams): Promise<DocumentSymbol[]> {
    const state = this.current(params);
    if (!state) {
      return [];
    }
    const official = consumeList(this.server.documentSymbol(params.document.uri), (item) => convertDocumentSymbol(item, state.offset))
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
    const official = consumeList(this.server.getDiagnostics(params.document.uri), (item) => convertDiagnostic(item, state.offset))
      .filter((item): item is Diagnostic => item !== undefined);
    const environment = validateShaderAuthoringEnvironment(state.environment).map((issue) => ({
      range: zeroRange(),
      severity: DiagnosticSeverity.Warning,
      source: "shader-studio-slang-ls",
      code: issue.code,
      message: issue.message,
    }));
    return [...official, ...environment];
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

function convertDocumentSymbol(item: SlangDocumentSymbol, offset: number): DocumentSymbol | undefined {
  const range = shiftedRange(item.range, -offset);
  const selectionRange = shiftedRange(item.selectionRange, -offset);
  const children = consumeList(item.children, (child) => convertDocumentSymbol(child, offset)).filter((child): child is DocumentSymbol => child !== undefined);
  return range.start.line < 0 ? undefined : { name: item.name, detail: item.detail, kind: item.kind as SymbolKind, range, selectionRange, children };
}

function convertDiagnostic(item: SlangDiagnostic, offset: number): Diagnostic | undefined {
  const range = shiftedRange(item.range, -offset);
  return range.start.line < 0 ? undefined : { code: item.code, range, severity: item.severity as DiagnosticSeverity, message: item.message, source: "shader-studio-slang-ls" };
}

function shiftedPosition(position: { line: number; character: number }, lines: number) {
  return { line: position.line + lines, character: position.character };
}
function shiftedRange(range: Range, lines: number): Range {
  return { start: shiftedPosition(range.start, lines), end: shiftedPosition(range.end, lines) };
}
function zeroRange(): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}
function slangType(type: string) {
  return type === "vec2" ? "float2" : type === "vec3" ? "float3" : type === "vec4" ? "float4" : type;
}
function markup(value: { kind: string; value: string }) {
  return { kind: value.kind === "plaintext" ? MarkupKind.PlainText : MarkupKind.Markdown, value: value.value };
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

const SLANG_FALLBACK_COMPLETIONS: readonly CompletionItem[] = [
  ["abs", "Returns the component-wise absolute value."],
  ["clamp", "Constrains values to a range."],
  ["cross", "Returns the cross product."],
  ["dot", "Returns the dot product."],
  ["lerp", "Linearly interpolates between values."],
  ["normalize", "Returns a vector with length one."],
  ["saturate", "Constrains values to zero through one."],
  ["sin", "Returns the sine of an angle."],
  ["cos", "Returns the cosine of an angle."],
  ["sqrt", "Returns the square root."],
].map(([label, description]) => Object.freeze({
  label,
  kind: CompletionItemKind.Function,
  detail: `${label}(...)`,
  documentation: { kind: MarkupKind.Markdown, value: description },
}));
