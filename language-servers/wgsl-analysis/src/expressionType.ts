import { parseMemberExpression, type MemberExpressionStep } from "@shader-studio/language-server-core";
import type { ShaderStage } from "@shader-studio/types";
import type { Position } from "vscode-languageserver-protocol";
import type { WgslAnalysisDocument, WgslSymbol } from "./model.js";
import { visibleSymbolsAtPosition } from "./parseWgslDocument.js";
import { parseWgslDocumentAtPosition } from "./recovery.js";
import {
  isBuiltinValueType,
  matrixType,
  parseWgslPointerType,
  resolveSwizzleType,
  vectorType,
  vectorTypeName,
  type WgslVectorType,
} from "./wgslTypes.js";

export interface WgslTypeField {
  readonly name: string;
  readonly type: string;
}

export interface WgslResolvedType {
  readonly name: string;
  /** Component layout when the type is a vector, so callers can offer swizzles. */
  readonly vector?: WgslVectorType;
  /** Declared fields when the type is a struct. */
  readonly fields?: readonly WgslTypeField[];
}

export interface WgslExpressionRequest {
  readonly uri: string;
  readonly source: string;
  readonly stage: ShaderStage;
  /** Cursor position the expression is being typed at, used to pick the enclosing scope. */
  readonly position: Position;
  readonly expression: string;
}

export interface WgslExpressionContext {
  /** Analyses of included documents whose declarations are also in scope. */
  readonly includes?: readonly WgslAnalysisDocument[];
  /** Types for names the document does not declare, such as host-provided uniforms. */
  readonly variableType?: (name: string) => string | undefined;
  /** Return types for functions the document does not declare, such as intrinsics. */
  readonly functionType?: (name: string) => string | undefined;
  /** Field types of structs the document does not declare, such as Common's. */
  readonly fieldType?: (owner: string, field: string) => string | undefined;
}

/**
 * Resolves the type of an expression being selected from, such as the `uv` in `uv.`.
 * The document is re-parsed with the statement under the cursor blanked out, so an
 * unfinished selection still resolves against every declaration that precedes it.
 */
export function resolveWgslExpressionType(
  request: WgslExpressionRequest,
  context: WgslExpressionContext = {},
): WgslResolvedType | undefined {
  // `(*pointer).member`: resolve the pointer, then select from what it points to.
  const dereference = /^\s*\(\s*\*\s*([^()]+?)\s*\)([\s\S]*)$/.exec(request.expression);
  const steps = parseMemberExpression(dereference ? dereference[1]! : request.expression);
  const trailing = dereference ? parseMemberExpression(`_${dereference[2]}`).slice(1) : [];
  if (!steps.length || (dereference && dereference[2]!.trim() !== "" && trailing.length === 0)) {
    return undefined;
  }
  const analysis = parseWgslDocumentAtPosition(
    request.uri,
    request.source,
    request.stage,
    request.position,
    { valueType: context.variableType, functionType: context.functionType, fieldType: context.fieldType },
  );
  const documents = [analysis, ...context.includes ?? []];
  let typeName = walkSteps(leadingStepType(steps[0], analysis, documents, request.position, context), steps.slice(1), documents);
  if (dereference) {
    const pointer = typeName === undefined ? undefined : parseWgslPointerType(resolveAlias(typeName, documents));
    typeName = walkSteps(pointer?.elementType, trailing, documents);
  }
  return typeName ? describeType(typeName, documents) : undefined;
}

function walkSteps(
  initial: string | undefined,
  steps: readonly MemberExpressionStep[],
  documents: readonly WgslAnalysisDocument[],
): string | undefined {
  let typeName = initial;
  for (const step of steps) {
    if (!typeName) {
      return undefined;
    }
    typeName = resolveAlias(typeName, documents);
    typeName = step.kind === "index"
      ? indexedTypeName(typeName)
      : resolveSwizzleType(typeName, step.kind === "member" ? step.name : "") ?? structFields(typeName, documents)?.find((field) => step.kind === "member" && field.name === step.name)?.type;
  }
  return typeName;
}

function describeType(name: string, documents: readonly WgslAnalysisDocument[]): WgslResolvedType {
  const resolvedName = resolveAlias(name, documents);
  const vector = vectorType(resolvedName);
  if (vector) {
    return { name: resolvedName, vector };
  }
  const fields = structFields(resolvedName, documents);
  return fields ? { name: resolvedName, fields } : { name: resolvedName };
}

function leadingStepType(
  step: MemberExpressionStep | undefined,
  analysis: WgslAnalysisDocument,
  documents: readonly WgslAnalysisDocument[],
  position: Position,
  context: WgslExpressionContext,
): string | undefined {
  if (step?.kind === "call") {
    if (isBuiltinValueType(step.name)) {
      return step.name;
    }
    return declaredType(documents, step.name, "function") ?? context.functionType?.(step.name);
  }
  if (step?.kind !== "identifier") {
    return undefined;
  }
  const visible = visibleSymbolsAtPosition(analysis, position)
    .find((symbol) => symbol.name === step.name && isValueSymbol(symbol));
  return visible?.typeName
    ?? declaredType(documents.slice(1), step.name, "value")
    ?? context.variableType?.(step.name);
}

function declaredType(
  documents: readonly WgslAnalysisDocument[],
  name: string,
  kind: "function" | "value",
): string | undefined {
  for (const document of documents) {
    const symbol = document.symbols.find((candidate) => candidate.name === name
      && (kind === "function" ? candidate.kind === "function" : isValueSymbol(candidate)));
    if (symbol?.typeName) {
      return symbol.typeName;
    }
  }
  return undefined;
}

function isValueSymbol(symbol: WgslSymbol): boolean {
  return symbol.kind === "variable" || symbol.kind === "parameter" || symbol.kind === "constant";
}

function structFields(
  typeName: string,
  documents: readonly WgslAnalysisDocument[],
): readonly WgslTypeField[] | undefined {
  for (const document of documents) {
    const scope = document.scopes.find((item) => item.kind === "type" && item.name === typeName);
    const fields = scope?.symbolIds
      .map((id) => document.symbols.find((symbol) => symbol.id === id))
      .filter((symbol): symbol is WgslSymbol => symbol?.kind === "field" && symbol.typeName !== undefined)
      .map((symbol) => ({ name: symbol.name, type: symbol.typeName ?? "" }));
    if (fields?.length) {
      return fields;
    }
  }
  return undefined;
}

/** WGSL aliases are transparent for member completion and indexing. */
function resolveAlias(name: string, documents: readonly WgslAnalysisDocument[]): string {
  const visited = new Set<string>();
  let resolved = name;
  while (!visited.has(resolved)) {
    visited.add(resolved);
    const alias = documents.flatMap((document) => document.symbols)
      .find((symbol) => symbol.kind === "type" && symbol.name === resolved && symbol.typeName !== undefined);
    if (!alias?.typeName) {
      break;
    }
    resolved = alias.typeName;
  }
  return resolved;
}

/** Element type of an indexed value: array elements, vector components, or matrix columns. */
function indexedTypeName(typeName: string): string | undefined {
  const array = /^array<\s*(.+?)\s*(?:,\s*\d+\s*)?>$/.exec(typeName);
  if (array?.[1]) {
    return array[1];
  }
  const vector = vectorType(typeName);
  if (vector) {
    return vector.componentType;
  }
  const matrix = matrixType(typeName);
  return matrix ? vectorTypeName(matrix.componentType, matrix.rows) : undefined;
}
