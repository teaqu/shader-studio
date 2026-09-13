import { parseMemberExpression, type MemberExpressionStep } from "@shader-studio/language-server-core";
import type { Position, Range } from "vscode-languageserver-protocol";
import {
  canonicalizeSlangType,
  isSlangScalarType,
  resolveSlangSwizzleType,
  slangMatrixType,
  slangVectorType,
  slangVectorTypeName,
  type SlangVectorType,
} from "./slangTypes.js";

export interface SlangTypeField {
  readonly name: string;
  readonly type: string;
}

export interface SlangResolvedType {
  readonly name: string;
  /** Component layout when the type is a vector, so callers can offer swizzles. */
  readonly vector?: SlangVectorType;
  /** Declared fields when the type is a struct. */
  readonly fields?: readonly SlangTypeField[];
}

export interface SlangExpressionRequest {
  readonly source: string;
  /** Cursor position the expression is being typed at, used to resolve local shadowing. */
  readonly position: Position;
  readonly expression: string;
}

export interface SlangExpressionContext {
  /** Source text of included documents whose declarations are also in scope. */
  readonly includes?: readonly string[];
  /** Types for names the document does not declare, such as host-provided uniforms. */
  readonly variableType?: (name: string) => string | undefined;
  /** Return types for functions the document does not declare, such as intrinsics. */
  readonly functionType?: (name: string) => string | undefined;
}

/**
 * Resolves the type of an expression being selected from, such as the `uv` in `uv.`.
 * Slang ships no accessible AST here, so declarations are found by scanning source text;
 * local variables and parameters are scope-checked against the cursor so an inner
 * declaration shadows an outer one with the same name, matching block scoping rules.
 */
export function resolveSlangExpressionType(
  request: SlangExpressionRequest,
  context: SlangExpressionContext = {},
): SlangResolvedType | undefined {
  const steps = parseMemberExpression(stripMethodArguments(request.expression));
  if (!steps.length) {
    return undefined;
  }
  const structs = findSlangStructs(request.source);
  const includeStructs = (context.includes ?? []).flatMap(findSlangStructs);
  const allStructs = [...structs, ...includeStructs];
  const cursorOffset = positionOffset(request.source, request.position);

  let typeName = leadingStepType(steps[0], request.source, cursorOffset, context);
  for (const step of steps.slice(1)) {
    if (!typeName) {
      return undefined;
    }
    typeName = step.kind === "index"
      ? indexedTypeName(typeName)
      : resolveSlangSwizzleType(typeName, step.name) ?? fieldType(typeName, step.name, allStructs) ?? builtinMethodType(typeName, step.name);
  }
  return typeName ? describeType(typeName, allStructs) : undefined;
}

/**
 * Drops the argument lists of method calls such as `.Sample(uv)`, so a chain like
 * `inputs.iChannel0.Sample(uv).rgb` resolves through the method's return type.
 * A leading call such as `palette(0.5)` keeps its arguments.
 */
function stripMethodArguments(expression: string): string {
  let result = "";
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index]!;
    if (character !== "(" || !/\.\s*[A-Za-z_]\w*\s*$/.test(result)) {
      result += character;
      continue;
    }
    let depth = 0;
    for (; index < expression.length; index++) {
      depth += expression[index] === "(" ? 1 : expression[index] === ")" ? -1 : 0;
      if (depth === 0) {
        break;
      }
    }
    if (depth !== 0) {
      return expression;
    }
  }
  return result;
}

const SAMPLING_METHODS = new Set(["Sample", "SampleLevel", "SampleGrad"]);
const TEXTURE_READ_METHODS = new Set([...SAMPLING_METHODS, "SampleBias", "Load"]);

/** Return type of a sampling method on a Shader Studio channel or a native texture. */
function builtinMethodType(ownerType: string, name: string): string | undefined {
  if (/^ShaderStudioChannel(?:2D|Cube|3D)$/.test(ownerType)) {
    return SAMPLING_METHODS.has(name) ? "float4" : undefined;
  }
  const element = /^(?:RW)?Texture(?:1D|2D|3D|Cube)(?:Array)?<\s*(.+?)\s*>$/.exec(ownerType)?.[1];
  return element && TEXTURE_READ_METHODS.has(name) ? canonicalizeSlangType(element) : undefined;
}

function describeType(name: string, structs: readonly SlangStruct[]): SlangResolvedType {
  const vector = slangVectorType(name);
  if (vector) {
    return { name, vector };
  }
  const fields = structs.find((candidate) => candidate.name === name)?.fields;
  return fields ? { name, fields } : { name };
}

function leadingStepType(
  step: MemberExpressionStep | undefined,
  source: string,
  cursorOffset: number | undefined,
  context: SlangExpressionContext,
  expandedMacros = new Set<string>(),
): string | undefined {
  if (step?.kind === "call") {
    if (isSlangScalarType(step.name) || slangVectorType(step.name) || slangMatrixType(step.name)) {
      return step.name;
    }
    return findSlangFunctions(source).find((item) => item.name === step.name)?.returnType
      ?? (context.includes ?? []).flatMap(findSlangFunctions).find((item) => item.name === step.name)?.returnType
      ?? context.functionType?.(step.name);
  }
  if (step?.kind !== "identifier") {
    return undefined;
  }
  const local = cursorOffset === undefined ? undefined : nearestVisibleDeclaration(source, step.name, cursorOffset, context.includes);
  const included = local ? undefined : (context.includes ?? [])
    .map((include) => globalDeclaredType(include, step.name))
    .find((typeName): typeName is string => typeName !== undefined);
  const declared = local?.typeName ?? included;
  if (declared) {
    return declared;
  }
  const replacement = expandedMacros.has(step.name) ? undefined : slangMacroReplacement(step.name, [source, ...(context.includes ?? [])]);
  if (!replacement) {
    return context.variableType?.(step.name);
  }
  expandedMacros.add(step.name);
  return leadingStepType(parseMemberExpression(stripOuterParentheses(replacement))[0], source, cursorOffset, context, expandedMacros);
}

function slangMacroReplacement(name: string, sources: readonly string[]): string | undefined {
  const define = new RegExp(`^\\s*#\\s*define\\s+${name}\\s+(.+?)\\s*$`, "m");
  return sources.map((source) => define.exec(source)?.[1]?.trim()).find((replacement): replacement is string => Boolean(replacement));
}

function stripOuterParentheses(expression: string): string {
  const trimmed = expression.trim();
  return trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1).trim() : trimmed;
}

function fieldType(ownerType: string, fieldName: string, structs: readonly SlangStruct[]): string | undefined {
  return structs.find((candidate) => candidate.name === ownerType)?.fields.find((field) => field.name === fieldName)?.type;
}

/** Element type of an indexed value: array or structured buffer elements, vector components, or matrix rows. */
function indexedTypeName(typeName: string): string | undefined {
  const buffer = /^(?:RW)?StructuredBuffer\s*<\s*(.+?)\s*>$/.exec(typeName)?.[1];
  if (buffer) {
    return canonicalizeSlangType(buffer);
  }
  const array = /^(.+?)((?:\[\d*\])+)$/.exec(typeName);
  if (array?.[1] && array[2]) {
    const dimensions = array[2].match(/\[\d*\]/g) ?? [];
    return dimensions.length > 1 ? `${array[1]}${dimensions.slice(1).join("")}` : array[1];
  }
  const vector = slangVectorType(typeName);
  if (vector) {
    return vector.componentType;
  }
  const matrix = slangMatrixType(typeName);
  return matrix ? slangVectorTypeName(matrix.componentType, matrix.columns) : undefined;
}

function positionOffset(source: string, position: Position): number | undefined {
  const lines = source.split("\n");
  const line = lines[position.line];
  if (line === undefined || position.character < 0 || position.character > line.length) {
    return undefined;
  }
  return lines.slice(0, position.line).reduce((offset, current) => offset + current.length + 1, 0) + position.character;
}

interface BracePair {
  readonly open: number;
  readonly close: number;
}

function bracePairs(source: string): readonly BracePair[] {
  const stack: number[] = [];
  const pairs: BracePair[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "{") {
      stack.push(index);
    } else if (source[index] === "}") {
      const open = stack.pop();
      if (open !== undefined) {
        pairs.push({ open, close: index });
      }
    }
  }
  return pairs;
}

/** Offset where the innermost block containing `offset` closes, or the end of the source at global scope. */
function enclosingScopeEnd(pairs: readonly BracePair[], offset: number, sourceLength: number): number {
  let best: BracePair | undefined;
  for (const pair of pairs) {
    if (pair.open <= offset && offset < pair.close && (!best || pair.close - pair.open < best.close - best.open)) {
      best = pair;
    }
  }
  return best?.close ?? sourceLength;
}

interface VariableDeclaration {
  readonly name: string;
  readonly typeName: string;
  readonly kind: SlangLocalKind;
  /** Where the declaration becomes visible: the name for a variable, the end of the parameter list for a parameter. */
  readonly offset: number;
  /** Offset of the declared name itself. */
  readonly nameOffset: number;
  readonly scopeEnd: number;
  /** A parameter bound to a semantic such as `SV_DispatchThreadID`, which the entry signature requires. */
  readonly semantic?: boolean;
}

export type SlangLocalKind = "variable" | "parameter";

export interface SlangLocalSymbol {
  readonly name: string;
  readonly typeName: string;
  readonly kind: SlangLocalKind;
}

const TYPE_TOKEN = /[A-Za-z_]\w*(?:\s*<[^>{}]+>)?/;
const LOCAL_DECLARATION = new RegExp(`\\b(?:(?:static|const)\\s+)*(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*(\\[\\s*\\d*\\s*\\])?\\s*(?:=\\s*(?:\\{[^;{}]*\\}|[^;{}]*))?;`, "g");
const CONTROL_KEYWORDS = new Set(["if", "for", "while", "switch", "return", "else"]);

/**
 * Every local variable and parameter declared in `source`, with the block each one lives in.
 * Structs declared in `includes`, such as Common, also count as declaration types.
 */
function declarationCandidates(source: string, includes: readonly string[] = []): readonly VariableDeclaration[] {
  const pairs = bracePairs(source);
  const knownTypes = new Set([source, ...includes].flatMap(findSlangStructs).map((struct) => struct.name));
  const candidates: VariableDeclaration[] = [];

  for (const match of source.matchAll(LOCAL_DECLARATION)) {
    const [, rawType, declaredName, arrayBrackets] = match;
    if (declaredName === undefined || match.index === undefined) {
      continue;
    }
    const baseType = canonicalizeSlangType(rawType ?? "");
    if (CONTROL_KEYWORDS.has(baseType) || !isKnownType(baseType, knownTypes)) {
      continue;
    }
    const typeName = arrayBrackets ? `${baseType}[]` : baseType;
    const offset = match.index + match[0].indexOf(declaredName, rawType?.length ?? 0);
    candidates.push({
      name: declaredName,
      typeName,
      kind: "variable",
      offset,
      nameOffset: offset,
      scopeEnd: enclosingScopeEnd(pairs, offset, source.length),
    });
  }

  for (const fn of findSlangFunctions(source)) {
    const body = /^\s*{/.exec(source.slice(fn.parameterListEnd));
    if (!body) {
      continue;
    }
    const bodyOpen = fn.parameterListEnd + (source.slice(fn.parameterListEnd).indexOf("{"));
    const scopeEnd = enclosingScopeEnd(pairs, bodyOpen, source.length);
    for (const parameter of fn.parameters) {
      candidates.push({
        name: parameter.name,
        typeName: parameter.typeName,
        kind: "parameter",
        offset: fn.parameterListEnd,
        nameOffset: parameter.nameOffset,
        scopeEnd,
        semantic: parameter.semantic,
      });
    }
  }

  return candidates;
}

/** Every declaration of `name` in `source`, whether a local variable, parameter, or array. */
function variableCandidates(source: string, name: string, includes: readonly string[] = []): readonly VariableDeclaration[] {
  return declarationCandidates(source, includes).filter((candidate) => candidate.name === name);
}

/**
 * Local variables and parameters visible at the cursor. Slang's language server offers no
 * identifier completions for these, so they are recovered by scanning source text; an inner
 * declaration shadows an outer one of the same name, matching block scoping rules.
 */
export function visibleSlangLocals(source: string, position: Position, includes: readonly string[] = []): readonly SlangLocalSymbol[] {
  const cursorOffset = positionOffset(source, position);
  if (cursorOffset === undefined) {
    return [];
  }
  const visible = new Map<string, SlangLocalSymbol>();
  for (const candidate of declarationCandidates(source, includes)
    .filter((entry) => entry.offset < cursorOffset && cursorOffset <= entry.scopeEnd)
    .sort((left, right) => right.offset - left.offset)) {
    if (!visible.has(candidate.name)) {
      visible.set(candidate.name, { name: candidate.name, typeName: candidate.typeName, kind: candidate.kind });
    }
  }
  return [...visible.values()];
}

/**
 * The local variable or parameter named by the word at `position`, whether the word is its
 * declaration or a reference to the nearest visible declaration. Member selections and
 * calls name something else, so they report nothing.
 */
export function findSlangLocalAt(source: string, position: Position, includes: readonly string[] = []): SlangLocalSymbol | undefined {
  const cursorOffset = positionOffset(source, position);
  if (cursorOffset === undefined) {
    return undefined;
  }
  let start = cursorOffset;
  while (start > 0 && /\w/.test(source[start - 1] ?? "")) {
    start--;
  }
  let end = cursorOffset;
  while (end < source.length && /\w/.test(source[end] ?? "")) {
    end++;
  }
  const name = source.slice(start, end);
  // A selector or call on the same line; a comment ending in a full stop is not one.
  const masked = maskNonCode(source);
  if (!/^[A-Za-z_]\w*$/.test(name) || /\.[ \t]*$/.test(masked.slice(0, start)) || /^[ \t]*\(/.test(masked.slice(end))) {
    return undefined;
  }
  const candidates = variableCandidates(source, name, includes);
  const declaration = candidates.find((candidate) => candidate.nameOffset === start)
    ?? candidates
      .filter((candidate) => candidate.offset < start && start <= candidate.scopeEnd)
      .sort((left, right) => right.offset - left.offset)[0];
  return declaration ? { name, typeName: declaration.typeName, kind: declaration.kind } : undefined;
}

export interface SlangUnusedLocal {
  readonly name: string;
  readonly kind: SlangLocalKind;
  readonly range: Range;
}

const MASKABLE_SPAN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

/** Blanks comments and string literals while preserving offsets, so only real code is scanned. */
function maskNonCode(source: string): string {
  return source.replace(MASKABLE_SPAN, (match) => match.replace(/[^\n]/g, " "));
}

function offsetToPosition(source: string, offset: number): Position {
  const lines = source.split("\n");
  let remaining = offset;
  for (let line = 0; line < lines.length; line++) {
    const length = lines[line]?.length ?? 0;
    if (remaining <= length) {
      return { line, character: remaining };
    }
    remaining -= length + 1;
  }
  const last = lines.length - 1;
  return { line: last, character: lines[last]?.length ?? 0 };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Offset of a parameter's name. Declaration candidates anchor parameters at
 * the function body's opening brace, so the parameter list just before it is
 * searched for the declaring occurrence.
 */
function parameterNameOffset(masked: string, name: string, bodyOpen: number): number | undefined {
  const listClose = masked.lastIndexOf(")", bodyOpen);
  if (listClose < 0) {
    return undefined;
  }
  let depth = 0;
  let listOpen = -1;
  for (let index = listClose - 1; index >= 0; index--) {
    if (masked[index] === ")") {
      depth++;
    } else if (masked[index] === "(") {
      if (depth === 0) {
        listOpen = index;
        break;
      }
      depth--;
    }
  }
  if (listOpen < 0) {
    return undefined;
  }
  let nameOffset: number | undefined;
  for (const match of masked.slice(listOpen + 1, listClose).matchAll(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g"))) {
    nameOffset = listOpen + 1 + (match.index ?? 0);
  }
  return nameOffset;
}

/**
 * Locals and parameters nothing reads. Slang ships no reference index here,
 * so each declaration's scope is scanned for word occurrences attributed to
 * the innermost visible declaration, matching block scoping rules. Only
 * declarations inside a function body count: file-scope globals, cbuffer
 * members, and struct fields are set or consumed outside the document and
 * stay quiet.
 */
export function findUnusedSlangLocals(source: string): readonly SlangUnusedLocal[] {
  const masked = maskNonCode(source);
  const pairs = bracePairs(masked);
  const bodies = findSlangFunctions(masked)
    .map((fn) => masked.indexOf("{", fn.parameterListEnd))
    .filter((open) => open >= 0)
    .map((open) => ({ open, close: enclosingScopeEnd(pairs, open, masked.length) }));
  const candidates = declarationCandidates(masked).filter((candidate) => (
    candidate.scopeEnd !== masked.length
    && !candidate.semantic
    && (candidate.kind === "parameter"
      || bodies.some((body) => body.open < candidate.offset && candidate.offset < body.close))
  ));
  const nameOffsets = new Map<VariableDeclaration, number>();
  for (const candidate of candidates) {
    nameOffsets.set(
      candidate,
      candidate.kind === "parameter"
        ? parameterNameOffset(masked, candidate.name, candidate.offset) ?? candidate.offset
        : candidate.offset,
    );
  }
  const byName = new Map<string, VariableDeclaration[]>();
  for (const candidate of candidates) {
    const group = byName.get(candidate.name) ?? [];
    group.push(candidate);
    byName.set(candidate.name, group);
  }
  const unused: SlangUnusedLocal[] = [];
  for (const candidate of candidates) {
    const sameName = byName.get(candidate.name) ?? [];
    const declarationOffsets = new Set(sameName.map((entry) => nameOffsets.get(entry) ?? entry.offset));
    const nameOffset = nameOffsets.get(candidate) ?? candidate.offset;
    const occurrences = new RegExp(`\\b${escapeRegExp(candidate.name)}\\b`, "g");
    let read = false;
    for (const match of masked.matchAll(occurrences)) {
      const occurrence = match.index ?? -1;
      if (occurrence <= nameOffset || occurrence >= candidate.scopeEnd || declarationOffsets.has(occurrence)) {
        continue;
      }
      const owner = sameName
        .filter((entry) => (nameOffsets.get(entry) ?? entry.offset) < occurrence && occurrence <= entry.scopeEnd)
        .sort((left, right) => (nameOffsets.get(right) ?? right.offset) - (nameOffsets.get(left) ?? left.offset))[0];
      if (owner === candidate) {
        read = true;
        break;
      }
    }
    if (!read) {
      const start = offsetToPosition(source, nameOffset);
      unused.push({
        name: candidate.name,
        kind: candidate.kind,
        range: { start, end: { line: start.line, character: start.character + candidate.name.length } },
      });
    }
  }
  return unused;
}

/** Finds the nearest declaration of `name` whose scope contains `cursorOffset`, so inner shadows outer. */
function nearestVisibleDeclaration(
  source: string,
  name: string,
  cursorOffset: number,
  includes: readonly string[] = [],
): VariableDeclaration | undefined {
  return variableCandidates(source, name, includes)
    .filter((candidate) => candidate.offset < cursorOffset && cursorOffset <= candidate.scopeEnd)
    .sort((left, right) => right.offset - left.offset)[0];
}

/** Type of a name declared at file scope, for declarations reached through an `#include`. */
function globalDeclaredType(source: string, name: string): string | undefined {
  const sourceLength = source.length;
  return variableCandidates(source, name).find((candidate) => candidate.scopeEnd === sourceLength)?.typeName;
}

function isKnownType(typeName: string, knownStructs: ReadonlySet<string>): boolean {
  return isSlangScalarType(typeName) || slangVectorType(typeName) !== undefined
    || slangMatrixType(typeName) !== undefined || knownStructs.has(typeName) || /^[A-Za-z_]\w*<.+>$/.test(typeName);
}

interface SlangStruct {
  readonly name: string;
  readonly fields: readonly SlangTypeField[];
}

const STRUCT_HEADER = /\bstruct\s+([A-Za-z_]\w*)\s*\{/g;
const FIELD_DECLARATION = new RegExp(`^\\s*(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*(?::\\s*[A-Za-z_]\\w*\\s*)?;`);

function findSlangStructs(text: string): SlangStruct[] {
  // Comments after a field, such as `float4 position; // xyz`, must not hide the next field.
  const source = maskNonCode(text);
  const pairs = bracePairs(source);
  const structs: SlangStruct[] = [];
  for (const match of source.matchAll(STRUCT_HEADER)) {
    const name = match[1];
    const open = (match.index ?? 0) + match[0].length - 1;
    const pair = pairs.find((candidate) => candidate.open === open);
    if (!name || !pair) {
      continue;
    }
    const body = source.slice(pair.open + 1, pair.close);
    const fields: SlangTypeField[] = [];
    for (const statement of body.split(";")) {
      const declaration = FIELD_DECLARATION.exec(`${statement.trim()};`);
      if (declaration?.[1] && declaration[2] && !statement.includes("(")) {
        fields.push({ name: declaration[2], type: canonicalizeSlangType(declaration[1]) });
      }
    }
    const property = new RegExp(`\\bproperty\\s+(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*\\{`, "g");
    for (const match of body.matchAll(property)) {
      if (match[1] && match[2] && !fields.some((field) => field.name === match[2])) {
        fields.push({ name: match[2], type: canonicalizeSlangType(match[1]) });
      }
    }
    const method = new RegExp(`\\b(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*\\(`, "g");
    for (const match of body.matchAll(method)) {
      if (match[1] && match[2] && !fields.some((field) => field.name === match[2])) {
        fields.push({ name: match[2], type: canonicalizeSlangType(match[1]) });
      }
    }
    structs.push({ name, fields });
  }
  return structs;
}

interface SlangFunctionDeclaration {
  readonly name: string;
  readonly returnType: string;
  readonly parameters: readonly { readonly name: string; readonly typeName: string; readonly nameOffset: number; readonly semantic: boolean }[];
  readonly parameterListEnd: number;
}

/** One parameter: qualifiers, type, name, optional array brackets, then an optional semantic and default value. */
const PARAMETER_DECLARATION = new RegExp(
  `^\\s*((?:(?:in|out|inout|const)\\s+)*)(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*(\\[\\s*\\d*\\s*\\])?(\\s*(?::\\s*[A-Za-z_]\\w*)?\\s*(?:=[\\s\\S]*)?)$`,
);

const FUNCTION_HEADER = new RegExp(`\\b(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{`, "g");

function findSlangFunctions(source: string): SlangFunctionDeclaration[] {
  const functions: SlangFunctionDeclaration[] = [];
  for (const match of source.matchAll(FUNCTION_HEADER)) {
    const [whole, rawReturnType, name, parameterList] = match;
    if (!name || rawReturnType === undefined || match.index === undefined || CONTROL_KEYWORDS.has(name)) {
      continue;
    }
    const parameters: { name: string; typeName: string; nameOffset: number; semantic: boolean }[] = [];
    let entryOffset = match.index + whole.indexOf("(") + 1;
    for (const entry of (parameterList ?? "").split(",")) {
      const parameter = PARAMETER_DECLARATION.exec(entry);
      if (parameter?.[2] && parameter[3]) {
        const brackets = parameter[4] ? "[]" : "";
        parameters.push({
          name: parameter[3],
          typeName: `${canonicalizeSlangType(parameter[2])}${brackets}`,
          nameOffset: entryOffset + parameter[0].lastIndexOf(parameter[3], parameter[0].length - (parameter[5]?.length ?? 0)),
          semantic: /^\s*:/.test(parameter[5] ?? ""),
        });
      }
      entryOffset += entry.length + 1;
    }
    functions.push({
      name,
      returnType: canonicalizeSlangType(rawReturnType),
      parameters,
      parameterListEnd: match.index + whole.length - 1,
    });
  }
  return functions;
}
