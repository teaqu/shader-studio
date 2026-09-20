import type { ShaderStage } from "@shader-studio/types";
import type { Position } from "vscode-languageserver-protocol";
import type { WgslAnalysisDocument, WgslSymbol } from "./model.js";
import { inferWgslExpressionType } from "./inferWgslExpressionType.js";
import { parseWgslExpression, visibleSymbolsAtPosition } from "./parseWgslDocument.js";
import { parseWgslDocumentAtPosition } from "./recovery.js";
import {
  vectorType,
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
  /** Targets for aliases declared outside this document, such as Common aliases. */
  readonly aliasType?: (name: string) => string | undefined;
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
  const expression = parseWgslExpression(request.expression);
  if (!expression) {
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
  const typeName = inferWgslExpressionType(expression, {
    valueType: (name) => visibleSymbolsAtPosition(analysis, request.position)
      .find((symbol) => symbol.name === name && isValueSymbol(symbol))?.typeName
      ?? declaredType(documents.slice(1), name, "value")
      ?? context.variableType?.(name),
    functionType: (name) => declaredType(documents, name, "function") ?? context.functionType?.(name),
    aliasType: (name) => aliasTarget(name, documents) ?? context.aliasType?.(name),
    fieldType: (owner, field) => structFields(owner, documents)?.find((candidate) => candidate.name === field)?.type
      ?? context.fieldType?.(owner, field),
    hasType: (name) => documents.some((document) => document.symbols.some((symbol) => symbol.kind === "type" && symbol.name === name)),
  });
  return typeName ? describeType(typeName, documents) : undefined;
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
    const target = aliasTarget(resolved, documents);
    if (!target) {
      break;
    }
    resolved = target;
  }
  return resolved;
}

function aliasTarget(name: string, documents: readonly WgslAnalysisDocument[]): string | undefined {
  return documents.flatMap((document) => document.symbols)
    .find((symbol) => symbol.kind === "type" && symbol.name === name && symbol.typeName !== undefined)?.typeName;
}
