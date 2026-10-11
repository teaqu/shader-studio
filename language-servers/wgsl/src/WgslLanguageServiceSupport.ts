import { isFragmentOnlyNativePosition } from "./NativeStageReachability.js";
import { declarationDocumentation } from "./documentation.js";
export { declarationDocumentation } from "./documentation.js";
import {
  findMemberAccess,
  literalColorFromArguments,
  memberSelectionAt,
  swizzleCompletions
} from "@shader-studio/language-server-core";
import {
  SHADER_STUDIO_SYMBOL_DOCS,
  isShaderLanguageReservedTerm,
  isValidShaderIdentifier,
  isWgslReservedWord,
  wgslStorageElementType,
  type ShaderAuthoringEnvironment
} from "@shader-studio/types";
import {
  positionOffset,
  resolveWgslExpressionType,
  symbolAtPosition,
  tokenizeWgsl,
  wgslVectorTypeName,
  type WgslAnalysisDocument,
  type WgslInferenceContext,
  type WgslSymbol,
  type WgslToken
} from "@shader-studio/wgsl-analysis";
import {
  CompletionItemKind,
  DiagnosticSeverity,
  DiagnosticTag,
  MarkupKind,
  SymbolKind,
  type CompletionItem,
  type Diagnostic,
  type Hover,
  type Location,
  type ParameterInformation,
  type Position,
  type Range,
  type SignatureInformation
} from "vscode-languageserver-protocol";
import {
  WGSL_MAIN_IMAGE_COORDINATE_DESCRIPTION,
  WGSL_MAIN_IMAGE_DESCRIPTION,
} from "./fragmentHook.js";
import { WGSL_INTRINSICS } from "./intrinsics.js";
import { WGSL_VERTEX_HOOK_FEATURES, type WgslVertexHookFeature } from "./vertexHook.js";

const CHANNEL_DECLARATIONS_URI = "shader-studio://generated/channels.wgsl";

/**
 * Warns about local variables and parameters nothing reads. Globals stay
 * quiet because uniforms and shared helpers are often set or used outside the
 * document, and functions are entry points or API surface rather than dead
 * locals. Assignments count as references in the analysis, so a variable the
 * body writes to is considered used.
 */
export function unusedSymbolDiagnostics(analysis: WgslAnalysisDocument): Diagnostic[] {
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

export function isRenameableName(name: string): boolean {
  return isValidShaderIdentifier(name) && !isShaderLanguageReservedTerm("wgsl", name);
}

/** Sorts ranges by position and drops duplicates so edits never overlap. */
export function orderedRanges(ranges: readonly Range[]): Range[] {
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
export function symbolAtRenamePosition(document: WgslAnalysisDocument, position: Position): WgslSymbol | null {
  return symbolAtPosition(document, position) ?? symbolAtPosition(document, identifierPosition(document.source, position));
}

export function identifierPosition(source: string, position: Position): Position {
  const line = source.split("\n")[position.line];
  return position.character > 0 && line?.[position.character - 1] !== undefined
    && /[A-Za-z0-9_]/.test(line[position.character - 1]!)
    ? { line: position.line, character: position.character - 1 }
    : position;
}

export function includedReferenceRanges(analysis: WgslAnalysisDocument, symbol: WgslSymbol): Range[] {
  const unresolved = analysis.unresolvedReferences.filter((reference) => reference.name === symbol.name).flatMap((reference) => reference.ranges);
  if (unresolved.length > 0 || symbol.kind !== "function") {
    return unresolved;
  }
  const tokens = tokenizeWgsl(analysis.source);
  return tokens.flatMap((token, index) => token.text === symbol.name && tokens[index + 1]?.text === "("
    ? [{ start: { line: token.line, character: token.character }, end: { line: token.line, character: token.character + token.text.length } }]
    : []);
}

export function deduplicateLocations(locations: Location[]): Location[] {
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
export function memberCompletions(
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
    // Includes whatever valid selection is being typed, so a deliberate
    // `uv.xyx` completes instead of closing the popup on no match.
    return swizzleCompletions(vector.size, WGSL_SWIZZLE_SETS, memberSelectionAt(source, position))
      .map((selection, index) => ({
        label: selection,
        kind: CompletionItemKind.Field,
        sortText: index.toString().padStart(4, "0"),
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

export function authoringValueWgslType(type: string): string {
  switch (type) {
    case "float": return "f32";
    case "vec2": return "vec2f";
    case "vec3": return "vec3f";
    case "vec4": return "vec4f";
    default: return "bool";
  }
}

export function completionFromDoc(name: string, detail: string | undefined, description: string): CompletionItem {
  return { label: name, kind: CompletionItemKind.Variable, detail, documentation: markdownDocumentation(description) };
}

export function markdownDocumentation(description: string) {
  return { kind: MarkupKind.Markdown, value: description } as const;
}

export function markdownHover(signature: string, description: string): Hover {
  return { contents: { kind: MarkupKind.Markdown, value: `\`\`\`wgsl\n${signature}\n\`\`\`\n\n${description}` } };
}

export function completionKind(symbol: WgslSymbol): CompletionItemKind {
  return symbol.kind === "function" ? CompletionItemKind.Function
    : symbol.kind === "type" ? CompletionItemKind.Struct
      : symbol.kind === "field" ? CompletionItemKind.Field
        : CompletionItemKind.Variable;
}

export function documentSymbolKind(symbol: WgslSymbol): SymbolKind {
  return symbol.kind === "function" ? SymbolKind.Function
    : symbol.kind === "type" ? SymbolKind.Struct
      : symbol.kind === "field" ? SymbolKind.Field
        : SymbolKind.Variable;
}

export function vertexHookFeature(analysis: WgslAnalysisDocument, symbol: WgslSymbol): WgslVertexHookFeature | undefined {
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
    && parameters.length === 4
    && parameters[0]?.typeName === "u32"
    && parameters.slice(1).every((parameter) => parameter.typeName?.startsWith("ptr<function,") ?? false)
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

export interface WgslMainImageFeature {
  readonly signature: string;
  readonly description: string;
}

const WGSL_VEC2_TYPES = new Set(["vec2f", "vec2<f32>"]);
const WGSL_VEC4_TYPES = new Set(["vec4f", "vec4<f32>"]);

export function mainImageFeature(analysis: WgslAnalysisDocument, symbol: WgslSymbol): WgslMainImageFeature | undefined {
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

export function comparePosition(left: Position, right: Position): number {
  return left.line === right.line ? left.character - right.character : left.line - right.line;
}

export function visibleIntrinsics(stage: ShaderAuthoringEnvironment["stage"]) {
  const wgsl = wgslStage(stage);
  return WGSL_INTRINSICS.filter((item) => item.stages.includes(wgsl));
}

export function wgslStage(stage: ShaderAuthoringEnvironment["stage"]): "fragment" | "vertex" | "compute" {
  return stage === "vertex" ? "vertex" : stage === "compute" ? "compute" : "fragment";
}

export function wordAt(source: string, position: Position): string | undefined {
  const line = source.split("\n")[position.line];
  if (line === undefined || position.character < 0 || position.character > line.length) {
    return undefined;
  }
  const left = line.slice(0, position.character).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  const right = line.slice(position.character).match(/^[A-Za-z0-9_]*/)?.[0] ?? "";
  return `${left}${right}` || undefined;
}

export function zeroRange() {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

export const SERVICE_SOURCE = "shader-studio-wgsl-ls";
export const GENERATED_CHANNEL_DESCRIPTION = "Generated by Shader Studio for the configured channels.";

export interface WgslCallableDescription {
  readonly name: string;
  readonly parameters: readonly { readonly name: string; readonly type: string }[];
  readonly returnType?: string;
  readonly description: string;
}

/** Prelude functions the renderer injects for this stage outside any parsed source. */
export function generatedWgslFunctions(environment: ShaderAuthoringEnvironment): WgslCallableDescription[] {
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

export function signatureInformation(
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

export function functionSignatures(analysis: WgslAnalysisDocument, name: string, provenance: string): SignatureInformation[] {
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
export function typedName(name: string, typeName: string | undefined): string {
  return typeName === undefined ? name : `${name}: ${typeName}`;
}

/** An authored declaration as WGSL spells it: `let uv: vec2f`, `fn f(x: f32) -> f32`, `struct S`. */
export function declarationLabel(analysis: WgslAnalysisDocument, symbol: WgslSymbol): string {
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

/** Whether the identifier under the cursor names an attribute: `@` sits right before it. */
export function isAttributeName(source: string, position: Position): boolean {
  const line = source.split("\n")[position.line] ?? "";
  const start = position.character - (line.slice(0, position.character).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0].length ?? 0);
  return /@\s*$/.test(line.slice(0, start));
}

/**
 * The innermost call whose argument list holds the cursor, and the index of
 * the argument being written. Tokens rather than characters, so comments are
 * skipped; commas count only at the call's own nesting level, and a template
 * list such as `array<f32, 4>(` belongs to its callee. A `;` or brace ends any
 * call, which bounds the scan when earlier code is broken.
 */
export function callAt(source: string, position: Position): { name: string; parameter: number } | undefined {
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

export interface WgslLiteralColor {
  readonly color: { red: number; green: number; blue: number; alpha: number };
  readonly range: Range;
  /** Constructor text through its opening parenthesis, exactly as authored. */
  readonly head: string;
  readonly components: 3 | 4;
}

/** `vec3f`/`vec4f` and `vec3<f32>`/`vec4<f32>`, with WGSL's optional template whitespace. */
const WGSL_COLOR_CONSTRUCTOR = /\bvec([34])(?:f|\s*<\s*f32\s*>)\s*\(([^()]*)\)/g;

export function findWgslLiteralColors(source: string): WgslLiteralColor[] {
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

export function rangeKey(range: Range): string {
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}

export function errorDiagnostic(range: Range, code: string, message: string): Diagnostic {
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
export function reservedWordDiagnostics(analysis: WgslAnalysisDocument): Diagnostic[] {
  return analysis.symbols
    .filter((symbol) => !analysis.hostGlobalIds.has(symbol.id) && isWgslReservedWord(symbol.name))
    .map((symbol) => errorDiagnostic(symbol.declaration, "reserved-word", `'${symbol.name}' is a reserved word in WGSL and cannot name a declaration.`));
}

export function unresolvedReferenceDiagnostics(
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
export function stageDiagnostics(
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

export interface RestrictedStageUse {
  readonly token: WgslToken;
  readonly code: "stage-unavailable-builtin" | "stage-unavailable-statement";
  readonly message: string;
}

export interface IncludedStageViolation {
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
export function samplingStageWarnings(
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
      if (isFragmentOnlyNativePosition(analysis.source, range.start)) {
        continue;
      }
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
export function inferenceContext(environment: ShaderAuthoringEnvironment, includes: readonly WgslAnalysisDocument[]): WgslInferenceContext {
  const context = expressionContext(environment, includes);
  return {
    valueType: context.variableType,
    functionType: context.functionType,
    aliasType: context.aliasType,
    fieldType: context.fieldType,
  };
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
    aliasType: (name: string) => includes.flatMap((document) => document.symbols)
      .find((symbol) => symbol.kind === "type" && symbol.name === name)?.typeName,
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

export interface IdentifierSite {
  readonly kind: "attribute-name" | "attribute-argument" | "member" | "plain";
  readonly start: Position;
  readonly name: string;
}

/** Where the identifier under the cursor sits syntactically, from tokens so comments never count. */
export function identifierSite(source: string, position: Position): IdentifierSite | undefined {
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
export function memberHover(
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
