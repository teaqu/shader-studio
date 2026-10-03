import {
  VirtualFileSystem,
  findMemberAccess,
  memberSelectionAt,
  swizzleCompletions
} from "@shader-studio/language-server-core";
import {
  SHADER_STUDIO_SYMBOL_DOCS,
  buildSlangAuthoringModule,
  describeSlangChannel, findSlangAuthoredDeclarations, isValidShaderIdentifier, type AuthoringResource,
  type ShaderAuthoringEnvironment
} from "@shader-studio/types";
import {
  CompletionItemKind,
  DiagnosticSeverity,
  MarkupKind,
  SymbolKind,
  type CompletionItem,
  type Diagnostic,
  type DocumentSymbol,
  type MarkupContent,
  type Position,
  type Range
} from "vscode-languageserver-protocol";
import { type SlangComputeFeature } from "./computeFeatures.js";
import { resolveSlangExpressionType, type SlangExpressionContext } from "./expressionType.js";
import { SLANG_MAIN_IMAGE_COORDINATE_DESCRIPTION, SLANG_MAIN_IMAGE_DESCRIPTION } from "./fragmentHook.js";
import { SLANG_INTRINSICS, type SlangIntrinsic } from "./intrinsics.js";
import type { SlangProviderState } from "./providers/SlangProviderContext.js";
import type {
  SlangDiagnostic,
  SlangDocumentSymbol,
  SlangLanguageServer,
  SlangList
} from "./slangLanguageServerTypes.js";
import { SLANG_SWIZZLE_SETS, resolveSlangSwizzleType, slangVectorTypeName } from "./slangTypes.js";
import { SLANG_VERTEX_HOOK_FEATURES, type SlangVertexHookFeature } from "./vertexHook.js";

export function contextualFiles(environment: ShaderAuthoringEnvironment) {
  return environment.commonFile
    ? [environment.commonFile, ...environment.virtualFiles]
    : environment.virtualFiles;
}

export function computeFeatureMarkup(feature: SlangComputeFeature) {
  return { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${feature.syntax}\n\`\`\`\n\n${feature.description}` } as const;
}

export function vertexHookMarkup(feature: SlangVertexHookFeature) {
  return contractMarkup(feature.signature, feature.description);
}

export function contractMarkup(signature: string, description: string) {
  return { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${signature}\n\`\`\`\n\n${description}` } as const;
}

export interface SlangMainImageFeature {
  readonly signature: string;
  readonly description: string;
  readonly line: number;
}

export function mainImageMarkup(feature: SlangMainImageFeature, uri: string) {
  const filename = sourcePath(uri).split("/").pop() || "shader.slang";
  const contents = contractMarkup(feature.signature, feature.description);
  return { ...contents, value: `${contents.value}\n\nDefined in ${filename}(${feature.line})` };
}

export function mainImageFeatureAt(
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

export function mainImageCompletionFeature(
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

export function mainImageCoordinateCompletion(
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

export function vertexHookFeatureAt(
  source: string,
  position: { line: number; character: number },
  word: string,
): SlangVertexHookFeature | undefined {
  const offset = offsetAtPosition(source, position);
  for (const match of vertexHookMatches(source)) {
    if (word === "mainVertex" && offset >= match.nameStart && offset <= match.nameEnd) {
      return match.features[0];
    }
    if (offset < match.start || offset > match.end) {
      continue;
    }
    const feature = match.features.slice(1).find((item) => item.name === word);
    if (feature) {
      return feature;
    }
  }
  return undefined;
}

export function vertexHookCompletionFeatures(source: string): readonly SlangVertexHookFeature[] {
  return vertexHookMatches(source)[0]?.features ?? [SLANG_VERTEX_HOOK_FEATURES[0]];
}

interface SlangVertexHookMatch {
  readonly start: number;
  readonly end: number;
  readonly nameStart: number;
  readonly nameEnd: number;
  readonly features: readonly SlangVertexHookFeature[];
}

function vertexHookMatches(source: string): SlangVertexHookMatch[] {
  const pattern = /\bvoid\s+(mainVertex)\s*\(\s*inout\s+float3\s+([A-Za-z_]\w*)\s*,\s*inout\s+float3\s+([A-Za-z_]\w*)\s*,\s*inout\s+float2\s+([A-Za-z_]\w*)\s*\)/g;
  return [...source.matchAll(pattern)].flatMap((match) => {
    const functionName = match[1];
    const parameterNames = match.slice(2, 5);
    if (!functionName || parameterNames.some((name) => !name)) {
      return [];
    }
    const nameStart = match.index + match[0].indexOf(functionName);
    const signatureEnd = match.index + match[0].length;
    const bodyStart = signatureEnd + (source.slice(signatureEnd).match(/^\s*/)?.[0].length ?? 0);
    if (source[bodyStart] !== "{") {
      return [];
    }
    const bodyEnd = matchingBrace(source, bodyStart);
    const types = ["float3", "float3", "float2"] as const;
    const parameters = parameterNames.map((name, index): SlangVertexHookFeature => ({
      name: name!,
      kind: "parameter",
      signature: `inout ${types[index]} ${name}`,
      description: SLANG_VERTEX_HOOK_FEATURES[index + 1]!.description,
    }));
    const signature = `void mainVertex(${parameters.map((feature) => feature.signature).join(", ")})`;
    return [{
      start: match.index,
      end: bodyEnd,
      nameStart,
      nameEnd: nameStart + functionName.length,
      features: [{
        name: functionName,
        kind: "function",
        signature,
        description: SLANG_VERTEX_HOOK_FEATURES[0]!.description,
      }, ...parameters],
    }];
  });
}

export function consumeList<T, U>(list: SlangList<T> | undefined, convert: (value: T) => U): U[] {
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

export function convertDocumentSymbol(item: SlangDocumentSymbol, offset: number, source: string): DocumentSymbol | undefined {
  const range = userRange(item.range, offset, source);
  const selectionRange = userRange(item.selectionRange, offset, source);
  const children = consumeList(item.children, (child) => convertDocumentSymbol(child, offset, source)).filter((child): child is DocumentSymbol => child !== undefined);
  return range && selectionRange ? { name: item.name, detail: item.detail, kind: item.kind as SymbolKind, range, selectionRange, children } : undefined;
}

export function convertDiagnostic(item: SlangDiagnostic, offset: number, source: string): Diagnostic | undefined {
  const range = userRange(item.range, offset, source);
  return range ? { code: item.code, range, severity: item.severity as DiagnosticSeverity, message: item.message, source: "shader-studio-slang-ls" } : undefined;
}

export function shiftedPosition(position: { line: number; character: number }, lines: number) {
  return { line: position.line + lines, character: position.character };
}
function shiftedRange(range: Range, lines: number): Range {
  return { start: shiftedPosition(range.start, lines), end: shiftedPosition(range.end, lines) };
}
export function userRange(range: Range, offset: number, source: string): Range | undefined {
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
export function zeroRange(): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

function comparePositions(
  left: { line: number; character: number },
  right: { line: number; character: number },
): number {
  return left.line - right.line || left.character - right.character;
}

export function rangesOverlap(left: Range, right: Range): boolean {
  return comparePositions(left.start, right.end) < 0 && comparePositions(right.start, left.end) < 0;
}

export function consumeCompilerTargets(targets: import("./slangLanguageServerTypes.js").SlangCompileTarget[] | SlangList<import("./slangLanguageServerTypes.js").SlangCompileTarget>) {
  return Array.isArray(targets) ? targets : consumeList(targets, (item) => item);
}

const INCLUDE_STRING_PATTERN = /^[ \t]*(?:#include[ \t]+"([^"]+)"|__include[ \t]+"([^"]+)")[ \t]*$/gm;
const INCLUDE_IDENT_PATTERN = /^[ \t]*__include[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*;?[ \t]*$/gm;
const IMPORT_PATTERN = /^[ \t]*(?:__exported[ \t]+)?import[ \t]+(?:"([^"]+)"|([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))[ \t]*;?[ \t]*$/gm;
const MODULE_DECL_PATTERN = /^[ \t]*module\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*;[ \t]*[\r\n]*/m;
const IMPLEMENTING_DECL_PATTERN = /^[ \t]*implementing\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*;[ \t]*[\r\n]*/m;

export function resolveCompilerDependencies(
  source: string,
  ownerUri: string,
  files: ShaderAuthoringEnvironment["virtualFiles"],
): string {
  const fileSystem = new VirtualFileSystem();
  fileSystem.replaceEnvironment(files);
  const imported = new Set<string>();
  const resolving = new Set<string>();

  const resolveNested = (text: string, containingUri: string): string => {
    const dependency = (match: string, reference: string, once: boolean): string => {
      const uri = fileSystem.resolve(containingUri, reference);
      const file = uri ? fileSystem.read(uri) : undefined;
      if (!uri || !file) {
        return match;
      }
      if (resolving.has(uri) || (once && imported.has(uri))) {
        return "";
      }
      if (once) {
        imported.add(uri);
      }
      resolving.add(uri);
      const resolved = resolveNested(
        once ? file.text.replace(MODULE_DECL_PATTERN, "").replace(IMPLEMENTING_DECL_PATTERN, "") : file.text,
        uri,
      );
      resolving.delete(uri);
      return resolved;
    };
    const strings = text.replace(INCLUDE_STRING_PATTERN, (match: string, hashPath: string, includePath: string) => (
      dependency(match, hashPath || includePath, false)
    ));
    const identifiers = strings.replace(INCLUDE_IDENT_PATTERN, (match: string, identifier: string) => (
      dependency(match, `${identifier.replace(/_/g, "-").replace(/\./g, "/")}.slang`, false)
    ));
    return identifiers.replace(IMPORT_PATTERN, (match: string, quotedPath: string, moduleName: string) => (
      dependency(
        match,
        quotedPath || `${moduleName.replace(/_/g, "-").replace(/\./g, "/")}.slang`,
        true,
      )
    ));
  };

  return resolveNested(source, ownerUri);
}

export function sourcePath(uri: string): string {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "file:" ? decodeURIComponent(parsed.pathname) : `/${parsed.pathname || "shader.slang"}`;
  } catch {
    return uri.startsWith("/") ? uri : `/${uri}`;
  }
}

export function moduleName(source: string, uri: string): string {
  return source.match(/^\s*module\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/m)?.[1]
    ?? sourcePath(uri).split("/").pop()?.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_")
    ?? "shader";
}

export function parseCompilerDiagnostics(error: string, rootPath: string, offset: number, source: string): Diagnostic[] {
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
export function slangType(type: string) {
  return type === "vec2" ? "float2" : type === "vec3" ? "float3" : type === "vec4" ? "float4" : type;
}
export function markup(value: { kind: string; value: string }) {
  return { kind: value.kind === "plaintext" ? MarkupKind.PlainText : MarkupKind.Markdown, value: value.value };
}

export function localSourceHover(value: string, uri: string, line: number): string {
  const filename = sourcePath(uri).split("/").pop() || "shader.slang";
  return value.replace(/Defined in [0-9a-f]{32,64}\(\d+\)/gi, `Defined in ${filename}(${line})`);
}

export function currentDocumentDefinitionLine(
  server: Pick<SlangLanguageServer, "gotoDefinition">,
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

export function generatedLocalDefinitionLine(
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

export function wordAt(source: string, position: { line: number; character: number }): string | undefined {
  const line = source.split("\n")[position.line];
  if (line === undefined) {
    return undefined;
  }
  const left = line.slice(0, position.character).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  const right = line.slice(position.character).match(/^[A-Za-z0-9_]*/)?.[0] ?? "";
  return `${left}${right}` || undefined;
}

/**
 * Completions for a member selection such as `uv.`, listing the members of the selected
 * expression only. An expression whose type cannot be resolved contributes nothing, so a
 * selector never falls back to the full intrinsic and symbol list merged in by the caller.
 */
export function memberCompletions(
  expression: string,
  position: { line: number; character: number },
  source: string,
  environment: ShaderAuthoringEnvironment,
): CompletionItem[] {
  const resolved = resolveSlangExpressionType({ source, position, expression }, slangExpressionContext(environment));
  if (!resolved) {
    return [];
  }
  const vector = resolved.vector;
  if (vector) {
    // Includes whatever valid selection is being typed, so a deliberate
    // `uv.xyx` completes instead of closing the popup on no match.
    return swizzleCompletions(vector.size, SLANG_SWIZZLE_SETS, memberSelectionAt(source, position))
      .map((selection, index) => ({
        label: selection,
        kind: CompletionItemKind.Field,
        sortText: index.toString().padStart(4, "0"),
        detail: selection.length === 1 ? vector.componentType : slangVectorTypeName(vector.componentType, selection.length),
        documentation: { kind: MarkupKind.Markdown, value: `Component selection on \`${resolved.name}\`.` },
      }));
  }
  const inputMembers = shaderStudioInputMemberCompletions(resolved.name);
  if (inputMembers) {
    return inputMembers;
  }
  const fields = (resolved.fields ?? []).map((field) => ({
    label: field.name,
    kind: CompletionItemKind.Field,
    detail: field.type,
    documentation: { kind: MarkupKind.Markdown, value: `Field of \`${resolved.name}\`.` },
  }));
  return fields.length ? fields : nativeTextureMemberCompletions(resolved.name);
}

export function slangExpressionContext(environment: ShaderAuthoringEnvironment): SlangExpressionContext {
  return {
    includes: [buildSlangAuthoringModule(environment).text, ...contextualFiles(environment).map((file) => file.text)],
    variableType: (name) => environmentTypeName(name, environment),
    functionType: (name) => intrinsicReturnType(documentedSlangFunctions(environment).find((item) => item.name === name)?.signatures[0]),
  };
}

/**
 * Hover for the member selected at `position`, such as `albedo` in `m.albedo` or `rgb` in
 * `iChannel0.Sample(uv).rgb`, described by the type of the expression it selects from.
 */
export function memberHover(
  source: string,
  position: { line: number; character: number },
  word: string,
  environment: ShaderAuthoringEnvironment,
): MarkupContent | undefined {
  const line = source.split("\n")[position.line] ?? "";
  const typedBefore = line.slice(0, position.character).match(/[A-Za-z0-9_]*$/)?.[0] ?? "";
  const start = { line: position.line, character: position.character - typedBefore.length };
  const access = findMemberAccess(source, start);
  if (!access) {
    return undefined;
  }
  const members = memberCompletions(access.expression, start, source, environment).filter((item) => item.label === word);
  const methods = members.filter((item) => item.kind === CompletionItemKind.Method && item.detail);
  if (methods.length > 0) {
    const documentation = completionDocumentation(methods[0]!);
    return { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${methods.map((item) => item.detail).join("\n")}\n\`\`\`${documentation ? `\n\n${documentation}` : ""}` };
  }
  const context = slangExpressionContext(environment);
  const typeName = members[0]?.detail
    ?? resolveSlangExpressionType({ source, position: start, expression: `${access.expression}.${word}` }, context)?.name;
  if (!typeName) {
    return undefined;
  }
  const owner = resolveSlangExpressionType({ source, position: start, expression: access.expression }, context)?.name;
  const documentation = (members[0] ? completionDocumentation(members[0]) : undefined)
    ?? (owner && resolveSlangSwizzleType(owner, word) ? `Component selection on \`${owner}\`.` : owner ? `Member of \`${owner}\`.` : undefined);
  return { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${typeName} ${word}\n\`\`\`${documentation ? `\n\n${documentation}` : ""}` };
}

/**
 * Hover for a `module`, `import`, `implementing` or `__include` line. The server describes these
 * with an empty signature and a generated module hash, so name the directive instead.
 */
export function moduleDirectiveHover(
  source: string,
  position: { line: number; character: number },
  word: string,
  environment: ShaderAuthoringEnvironment,
): MarkupContent | undefined {
  const directive = /^\s*(module|import|implementing|__include)\s+([A-Za-z_][\w.]*)\s*;/.exec(source.split("\n")[position.line] ?? "");
  const [, keyword, moduleName] = directive ?? [];
  if (!keyword || !moduleName || (word !== keyword && !moduleName.split(".").includes(word))) {
    return undefined;
  }
  const path = `${moduleName.replace(/\./g, "/")}.slang`;
  const file = environment.virtualFiles.find((candidate) => candidate.uri.endsWith(`/${path}`));
  const description = keyword === "module"
    ? "Names this file's module."
    : keyword === "implementing"
      ? `Makes this file part of the \`${moduleName}\` module.`
      : `Brings in the declarations of \`${file ? path : moduleName}\`.`;
  return { kind: MarkupKind.Markdown, value: `\`\`\`slang\n${keyword} ${moduleName}\n\`\`\`\n\n${description}` };
}

function completionDocumentation(item: CompletionItem): string | undefined {
  const documentation = typeof item.documentation === "string" ? item.documentation : item.documentation?.value;
  return documentation?.trim() || undefined;
}

function shaderStudioInputMemberCompletions(typeName: string): CompletionItem[] | undefined {
  const kind = typeName === "ShaderStudioChannel2D" ? "texture-2d"
    : typeName === "ShaderStudioChannelCube" ? "texture-cube"
      : typeName === "ShaderStudioChannel3D" ? "texture-3d" : undefined;
  if (!kind) {
    return undefined;
  }
  const description = describeSlangChannel(kind);
  const fields: CompletionItem[] = [
    { label: "texture", kind: CompletionItemKind.Field, detail: description.textureType },
    { label: "sampler", kind: CompletionItemKind.Field, detail: "SamplerState" },
    { label: "size", kind: CompletionItemKind.Field, detail: description.sizeType },
    { label: "time", kind: CompletionItemKind.Field, detail: "float" },
    { label: "loaded", kind: CompletionItemKind.Field, detail: "bool" },
  ];
  return [...fields, ...description.methods.flatMap(({ name, parameters }) => [
    inputMethodCompletion(typeName, name, parameters),
    inputMethodCompletion(typeName, name, `SamplerState sampling, ${parameters}`),
  ])];
}

function inputMethodCompletion(typeName: string, name: string, parameters: string): CompletionItem {
  return {
    label: name,
    kind: CompletionItemKind.Method,
    detail: `float4 ${typeName}.${name}(${parameters})`,
    documentation: { kind: MarkupKind.Markdown, value: "Shader Studio input sampling method." },
  };
}

export function isGeneratedInputImplementationSymbol(name: string): boolean {
  return /^_ss(?:Texture|Sampler|ChannelResolution|ChannelTime|ChannelLoaded)\d*$/.test(name);
}

export function shaderStudioInputMethodSignaturesAtCall(
  state: SlangProviderState,
  position: { line: number; character: number },
  name: string,
): string[] {
  if (!["Sample", "SampleLevel", "SampleGrad"].includes(name)) {
    return [];
  }
  const prefix = state.document.text.slice(0, offsetAtPosition(state.document.text, position));
  const receiver = prefix.match(new RegExp(`([A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*)\\.\\s*${name}\\s*\\([^()]*$`))?.[1];
  if (!receiver) {
    return [];
  }
  const resolved = resolveSlangExpressionType({ source: state.document.text, position, expression: receiver }, {
    includes: [buildSlangAuthoringModule(state.environment).text],
    variableType: name => environmentTypeName(name, state.environment),
  });
  return (shaderStudioInputMemberCompletions(resolved?.name ?? "") ?? [])
    .filter((item) => item.label === name)
    .map((item) => item.detail ?? "");
}

/** Native resource fallback for the bundled Slang server, which omits Texture* member completions. */
function nativeTextureMemberCompletions(typeName: string): CompletionItem[] {
  const texture = /^(Texture2D|TextureCube|Texture3D)<float4>$/.exec(typeName)?.[1];
  if (!texture) {
    return [];
  }
  const coordinates = texture === "Texture2D" ? "float2 location" : "float3 location";
  const gradients = texture === "Texture2D" ? "float2 ddx, float2 ddy" : "float3 ddx, float3 ddy";
  const loadCoordinates = texture === "Texture2D" ? "int3 location" : "int4 location";
  const dimensions = texture === "Texture2D" ? "out uint width, out uint height" : "out uint width, out uint height, out uint depth";
  return [
    nativeTextureMember(texture, "Sample", `float4 ${texture}.Sample(SamplerState sampler, ${coordinates})`),
    nativeTextureMember(texture, "SampleLevel", `float4 ${texture}.SampleLevel(SamplerState sampler, ${coordinates}, float level)`),
    nativeTextureMember(texture, "SampleGrad", `float4 ${texture}.SampleGrad(SamplerState sampler, ${coordinates}, ${gradients})`),
    nativeTextureMember(texture, "Load", `float4 ${texture}.Load(${loadCoordinates})`),
    nativeTextureMember(texture, "GetDimensions", `void ${texture}.GetDimensions(${dimensions})`),
  ];
}

function nativeTextureMember(texture: string, name: string, detail: string): CompletionItem {
  return {
    label: name,
    kind: CompletionItemKind.Method,
    detail,
    documentation: { kind: MarkupKind.Markdown, value: `Native \`${texture}\` method.` },
  };
}

export function generatedEnvironmentGlobals(environment: ShaderAuthoringEnvironment): readonly { name: string; type: string }[] {
  return environment.resources
    .filter(resource => resource.kind !== "storage" && isValidShaderIdentifier(resource.name))
    .map(resource => ({ name: resource.name, type: `ShaderStudioChannel${describeSlangChannel(resource.kind as "texture-2d" | "texture-cube" | "texture-3d").shape}` }));
}

export function generatedSamplingFunctions(environment: ShaderAuthoringEnvironment): SlangDeclaration[] {
  return findSlangDeclarations(buildSlangAuthoringModule(environment).text)
    .filter(item => /^sample(?:2D|Cube|3D)(?:Level|Grad)?$/.test(item.name));
}

/** Type of a name the document never declares, such as a uniform supplied by Shader Studio. */
/** Buffer type the generated module declares for a storage resource; only compute passes may write. */
export function slangStorageBufferType(resource: Readonly<AuthoringResource>, stage: ShaderAuthoringEnvironment["stage"]): string {
  const elementType = slangStorageElementType(resource, stage);
  return `${stage === "compute" ? "RWStructuredBuffer" : "StructuredBuffer"}<${elementType}>`;
}

function slangStorageElementType(resource: Readonly<AuthoringResource>, stage: ShaderAuthoringEnvironment["stage"]): string {
  const elementType = resource.elementType ?? "float4";
  return stage === "compute" ? elementType : elementType.replace(/^Atomic<(u?int)>$/, "$1");
}

function environmentTypeName(name: string, environment: ShaderAuthoringEnvironment): string | undefined {
  const uniform = environment.customUniforms.find((item) => item.name === name);
  if (uniform) {
    return slangType(uniform.type);
  }
  const storage = environment.resources.find((resource) => resource.kind === "storage" && resource.name === name);
  if (storage) {
    return `${slangStorageElementType(storage, environment.stage)}[]`;
  }
  const documented = SHADER_STUDIO_SYMBOL_DOCS.find((item) => item.name === name
    && item.languages.includes("slang")
    && (!item.stages || item.stages.includes(environment.stage)));
  return documented?.slangType ?? generatedEnvironmentGlobals(environment).find(item => item.name === name)?.type;
}

/** Leading type token of an intrinsic signature, such as `bool` in `bool all(T value)`. */
function intrinsicReturnType(signature: string | undefined): string | undefined {
  return signature === undefined ? undefined : /^\s*([A-Za-z_]\w*)\s+[A-Za-z_]/.exec(signature)?.[1];
}

export interface SlangDeclaration {
  name: string;
  detail: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
}

/** Whether the shader declares a struct by this name, so it opens a declaration too. */
export function declaresSlangType(source: string, word: string): boolean {
  return findSlangDeclarations(source).some((declaration) => (
    declaration.kind === SymbolKind.Struct && declaration.name === word
  ));
}

export function findSlangDeclarations(source: string): SlangDeclaration[] {
  const declarations: SlangDeclaration[] = [];
  const patterns = [
    { expression: /\bstruct\s+([A-Za-z_]\w*)/g, kind: SymbolKind.Struct },
    { expression: /\b([A-Za-z_]\w*(?:\s*<[^>]+>)?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g, kind: SymbolKind.Function },
  ] as const;
  for (const { expression, kind } of patterns) {
    for (const match of source.matchAll(expression)) {
      const name = kind === SymbolKind.Struct ? match[1] : match[2];
      const typeName = kind === SymbolKind.Function ? match[1]?.replace(/\s*<[^>]+>$/, "") : undefined;
      if (
        !name
        || ["if", "for", "while", "switch"].includes(name)
        || typeName === "return"
      ) {
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

/** Finds declarations at module scope without treating locals or members as globals. */
export function authoredChannelCollisionDiagnostics(
  state: SlangProviderState,
): Diagnostic[] {
  const channels = new Set(state.environment.resources
    .filter((resource) => resource.kind !== "storage" && isValidShaderIdentifier(resource.name))
    .map((resource) => resource.name));
  if (channels.size === 0) {
    return [];
  }
  return findSlangAuthoredDeclarations(state.document.text)
    .filter((declaration) => channels.has(declaration.name))
    .map((declaration) => ({
      range: offsetRange(state.document.text, declaration.offset, declaration.offset + declaration.name.length),
      severity: DiagnosticSeverity.Error,
      source: "shader-studio-slang-ls",
      code: "channel-declaration-collision",
      message: `Shader declaration "${declaration.name}" conflicts with the configured input channel. Rename the declaration or the channel key.`,
    }));
}

function offsetRange(source: string, start: number, end: number): Range {
  return { start: positionAtOffset(source, start), end: positionAtOffset(source, end) };
}

function positionAtOffset(source: string, offset: number) {
  const lines = source.slice(0, offset).split("\n");
  return { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 };
}

export function authoredPointRange(source: string | undefined, offset: number): Range | undefined {
  if (!source) {
    return undefined;
  }
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(offset));
  if (!match) {
    return undefined;
  }
  return { start: positionAtOffset(source, offset), end: positionAtOffset(source, offset + match[0].length) };
}

export function nativeDefinitionKey(server: SlangLanguageServer, uri: string, position: { line: number; character: number }): string | undefined {
  const raw = server.gotoDefinition(uri, position);
  const location = consumeList(raw, (item) => item)[0];
  return location ? `${location.uri}\0${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}` : undefined;
}

export function identifierOccurrences(source: string): { name: string; position: Position; range: Range }[] {
  const result: { name: string; position: Position; range: Range }[] = [];
  const tokens = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][A-Za-z0-9_]*/g;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith("//") || token.startsWith("/*") || token.startsWith('"') || token.startsWith("'")) {
      continue;
    }
    const start = positionAtOffset(source, match.index!);
    result.push({ name: token, position: start, range: { start, end: positionAtOffset(source, match.index! + token.length) } });
  }
  return result;
}

const SLANG_CALL_KEYWORDS = new Set(["if", "for", "while", "switch", "return"]);

/**
 * The call whose argument list holds `position`, and which argument it is in. Commas inside
 * nested calls, index brackets, strings and comments do not count, a statement or block
 * boundary ends every open call, and a generic call such as `bit_cast<uint>(` names its callee.
 */
export function callAt(source: string, position: { line: number; character: number }): { name: string; parameter: number } | undefined {
  const lines = source.split("\n");
  if (lines[position.line] === undefined) {
    return undefined;
  }
  const offset = lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
  const prefix = source.slice(0, offset);
  let frames: { name?: string; commas: number; close: ")" | "]" }[] = [];
  let lastIdentifier: string | undefined;
  for (let index = 0; index < prefix.length; index++) {
    const character = prefix[index]!;
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
    if (character === '"') {
      const literal = /^"(?:\\.|[^"\\\n])*"?/.exec(prefix.slice(index))?.[0] ?? '"';
      index += literal.length - 1;
      lastIdentifier = undefined;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(prefix.slice(index))?.[0];
    if (identifier && !/[A-Za-z0-9_]/.test(prefix[index - 1] ?? "")) {
      lastIdentifier = identifier;
      index += identifier.length - 1;
      continue;
    }
    if (/\s/.test(character)) {
      continue;
    }
    if (character === "(") {
      const name = lastIdentifier ?? /([A-Za-z_]\w*)\s*<[\w\s,]*>\s*$/.exec(prefix.slice(0, index))?.[1];
      frames.push({ ...(name ? { name } : {}), commas: 0, close: ")" });
    } else if (character === "[") {
      frames.push({ commas: 0, close: "]" });
    } else if (character === ")" || character === "]") {
      const open = frames.map((frame) => frame.close).lastIndexOf(character);
      if (open >= 0) {
        frames = frames.slice(0, open);
      }
    } else if (character === ",") {
      const frame = frames[frames.length - 1];
      if (frame) {
        frame.commas += 1;
      }
    } else if (character === ";" || character === "{" || character === "}") {
      frames = [];
    }
    lastIdentifier = undefined;
  }
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index]!;
    if (frame.name !== undefined) {
      return SLANG_CALL_KEYWORDS.has(frame.name) ? undefined : { name: frame.name, parameter: frame.commas };
    }
  }
  return undefined;
}

export function documentedSlangFunctions(environment: ShaderAuthoringEnvironment): readonly SlangIntrinsic[] {
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
  return [...functions.values()];
}

function intrinsic(name: string, signature: string, description: string): SlangIntrinsic {
  return { name, signatures: [signature], description };
}

export function completionForIntrinsic(intrinsic: SlangIntrinsic): CompletionItem {
  return {
    label: intrinsic.name,
    kind: CompletionItemKind.Function,
    detail: intrinsic.signatures[0],
    documentation: intrinsicMarkup(intrinsic),
  };
}

export function intrinsicMarkup(intrinsic: SlangIntrinsic) {
  return {
    kind: MarkupKind.Markdown,
    value: `${intrinsic.signatures.map((signature) => `\`\`\`slang\n${signature}\n\`\`\``).join("\n\n")}\n\n${intrinsic.description}`,
  };
}
