import { parseMemberExpression, type MemberExpressionStep } from "@shader-studio/language-server-core";
import type { Position } from "vscode-languageserver-protocol";
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
  const steps = parseMemberExpression(request.expression);
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
      : resolveSlangSwizzleType(typeName, step.name) ?? fieldType(typeName, step.name, allStructs);
  }
  return typeName ? describeType(typeName, allStructs) : undefined;
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
  const local = cursorOffset === undefined ? undefined : nearestVisibleDeclaration(source, step.name, cursorOffset);
  const included = local ? undefined : (context.includes ?? [])
    .map((include) => globalDeclaredType(include, step.name))
    .find((typeName): typeName is string => typeName !== undefined);
  return local?.typeName ?? included ?? context.variableType?.(step.name);
}

function fieldType(ownerType: string, fieldName: string, structs: readonly SlangStruct[]): string | undefined {
  return structs.find((candidate) => candidate.name === ownerType)?.fields.find((field) => field.name === fieldName)?.type;
}

/** Element type of an indexed value: array elements, vector components, or matrix rows. */
function indexedTypeName(typeName: string): string | undefined {
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
  readonly offset: number;
  readonly scopeEnd: number;
}

const TYPE_TOKEN = /[A-Za-z_]\w*(?:\s*<\s*[A-Za-z_]\w*\s*,\s*[234]\s*>)?/;
const LOCAL_DECLARATION = new RegExp(`\\b(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*(\\[\\s*\\d*\\s*\\])?\\s*(?:=[^;{}]*)?;`, "g");
const QUALIFIER = /^(?:in|out|inout)\s+/;
const CONTROL_KEYWORDS = new Set(["if", "for", "while", "switch", "return", "else"]);

/** Every declaration of `name` in `source`, whether a local variable, parameter, or array. */
function variableCandidates(source: string, name: string): readonly VariableDeclaration[] {
  const pairs = bracePairs(source);
  const knownTypes = new Set(findSlangStructs(source).map((struct) => struct.name));
  const candidates: VariableDeclaration[] = [];

  for (const match of source.matchAll(LOCAL_DECLARATION)) {
    const [, rawType, declaredName, arrayBrackets] = match;
    if (declaredName !== name || match.index === undefined) {
      continue;
    }
    const baseType = canonicalizeSlangType(rawType ?? "");
    if (CONTROL_KEYWORDS.has(baseType) || !isKnownType(baseType, knownTypes)) {
      continue;
    }
    const typeName = arrayBrackets ? `${baseType}[]` : baseType;
    const offset = match.index + match[0].indexOf(declaredName, rawType?.length ?? 0);
    candidates.push({ name, typeName, offset, scopeEnd: enclosingScopeEnd(pairs, offset, source.length) });
  }

  for (const fn of findSlangFunctions(source)) {
    const body = /^\s*{/.exec(source.slice(fn.parameterListEnd));
    if (!body) {
      continue;
    }
    const bodyOpen = fn.parameterListEnd + (source.slice(fn.parameterListEnd).indexOf("{"));
    const scopeEnd = enclosingScopeEnd(pairs, bodyOpen, source.length);
    for (const parameter of fn.parameters) {
      if (parameter.name === name) {
        candidates.push({ name, typeName: parameter.typeName, offset: fn.parameterListEnd, scopeEnd });
      }
    }
  }

  return candidates;
}

/** Finds the nearest declaration of `name` whose scope contains `cursorOffset`, so inner shadows outer. */
function nearestVisibleDeclaration(source: string, name: string, cursorOffset: number): VariableDeclaration | undefined {
  return variableCandidates(source, name)
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
    || slangMatrixType(typeName) !== undefined || knownStructs.has(typeName);
}

interface SlangStruct {
  readonly name: string;
  readonly fields: readonly SlangTypeField[];
}

const STRUCT_HEADER = /\bstruct\s+([A-Za-z_]\w*)\s*\{/g;
const FIELD_DECLARATION = new RegExp(`^\\s*(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*(?::\\s*[A-Za-z_]\\w*\\s*)?;`);

function findSlangStructs(source: string): SlangStruct[] {
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
    structs.push({ name, fields });
  }
  return structs;
}

interface SlangFunctionDeclaration {
  readonly name: string;
  readonly returnType: string;
  readonly parameters: readonly { readonly name: string; readonly typeName: string }[];
  readonly parameterListEnd: number;
}

const FUNCTION_HEADER = new RegExp(`\\b(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{`, "g");

function findSlangFunctions(source: string): SlangFunctionDeclaration[] {
  const functions: SlangFunctionDeclaration[] = [];
  for (const match of source.matchAll(FUNCTION_HEADER)) {
    const [whole, rawReturnType, name, parameterList] = match;
    if (!name || rawReturnType === undefined || match.index === undefined || CONTROL_KEYWORDS.has(name)) {
      continue;
    }
    const parameters = (parameterList ?? "").split(",").flatMap((entry) => {
      const cleaned = entry.trim().replace(QUALIFIER, "");
      const parameter = new RegExp(`^(${TYPE_TOKEN.source})\\s+([A-Za-z_]\\w*)$`).exec(cleaned);
      return parameter?.[1] && parameter[2]
        ? [{ name: parameter[2], typeName: canonicalizeSlangType(parameter[1]) }]
        : [];
    });
    functions.push({
      name,
      returnType: canonicalizeSlangType(rawReturnType),
      parameters,
      parameterListEnd: match.index + whole.length - 1,
    });
  }
  return functions;
}
