import { parseMemberExpression, type MemberExpressionStep } from "@shader-studio/language-server-core";
import type { ShaderStage } from "@shader-studio/types";
import type { Position } from "vscode-languageserver-protocol";
import type { GlslAnalysisDocument, GlslSymbol } from "./model.js";
import { parseGlslDocument, visibleSymbolsAtPosition } from "./parseGlslDocument.js";
import {
  isBuiltinValueType,
  matrixType,
  resolveSwizzleType,
  vectorType,
  vectorTypeName,
  type VectorType,
} from "./glslTypes.js";

export interface GlslTypeField {
  readonly name: string;
  readonly type: string;
}

export interface GlslResolvedType {
  readonly name: string;
  /** Component layout when the type is a vector, so callers can offer swizzles. */
  readonly vector?: VectorType;
  /** Declared fields when the type is a struct. */
  readonly fields?: readonly GlslTypeField[];
}

export interface GlslExpressionRequest {
  readonly uri: string;
  readonly source: string;
  readonly stage: ShaderStage;
  /** Cursor position the expression is being typed at, used to pick the enclosing scope. */
  readonly position: Position;
  readonly expression: string;
}

export interface GlslExpressionContext {
  /** Analyses of included documents whose declarations are also in scope. */
  readonly includes?: readonly GlslAnalysisDocument[];
  /** Types for names the document does not declare, such as host-provided uniforms. */
  readonly variableType?: (name: string) => string | undefined;
  /** Return types for functions the document does not declare, such as intrinsics. */
  readonly functionType?: (name: string) => string | undefined;
}

/**
 * Resolves the type of an expression being selected from, such as the `uv` in `uv.`.
 * The document is re-parsed with the statement under the cursor blanked out, so an
 * unfinished selection still resolves against every declaration that precedes it.
 */
export function resolveGlslExpressionType(
  request: GlslExpressionRequest,
  context: GlslExpressionContext = {},
): GlslResolvedType | undefined {
  const steps = parseMemberExpression(request.expression);
  if (!steps.length) {
    return undefined;
  }
  const analysis = parseGlslDocument(
    request.uri,
    blankStatementAt(request.source, request.position),
    request.stage,
  );
  const documents = [analysis, ...context.includes ?? []];
  let typeName = leadingStepType(steps[0], analysis, documents, request.position, context);
  for (const step of steps.slice(1)) {
    if (!typeName) {
      return undefined;
    }
    typeName = step.kind === "index"
      ? indexedTypeName(typeName)
      : resolveSwizzleType(typeName, step.name) ?? structFields(typeName, documents)?.find((field) => field.name === step.name)?.type;
  }
  return typeName ? describeType(typeName, documents) : undefined;
}

function describeType(name: string, documents: readonly GlslAnalysisDocument[]): GlslResolvedType {
  const vector = vectorType(name);
  if (vector) {
    return { name, vector };
  }
  const fields = structFields(name, documents);
  return fields ? { name, fields } : { name };
}

function leadingStepType(
  step: MemberExpressionStep | undefined,
  analysis: GlslAnalysisDocument,
  documents: readonly GlslAnalysisDocument[],
  position: Position,
  context: GlslExpressionContext,
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
  documents: readonly GlslAnalysisDocument[],
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

function isValueSymbol(symbol: GlslSymbol): boolean {
  return symbol.kind === "variable" || symbol.kind === "parameter";
}

function structFields(
  typeName: string,
  documents: readonly GlslAnalysisDocument[],
): readonly GlslTypeField[] | undefined {
  for (const document of documents) {
    const scope = document.scopes.find((item) => item.kind === "type" && item.name === typeName);
    const fields = scope?.symbolIds
      .map((id) => document.symbols.find((symbol) => symbol.id === id))
      .filter((symbol): symbol is GlslSymbol => symbol?.kind === "field" && symbol.typeName !== undefined)
      .map((symbol) => ({ name: symbol.name, type: symbol.typeName ?? "" }));
    if (fields?.length) {
      return fields;
    }
  }
  return undefined;
}

/** Element type of an indexed value: array elements, vector components, or matrix columns. */
function indexedTypeName(typeName: string): string | undefined {
  const array = /^(.+?)((?:\[\d*\])+)$/.exec(typeName);
  if (array?.[1] && array[2]) {
    const dimensions = array[2].match(/\[\d*\]/g) ?? [];
    return dimensions.length > 1 ? `${array[1]}${dimensions.slice(1).join("")}` : array[1];
  }
  const vector = vectorType(typeName);
  if (vector) {
    return vector.componentType;
  }
  const matrix = matrixType(typeName);
  return matrix ? vectorTypeName(matrix.componentType, matrix.rows) : undefined;
}

/**
 * Replaces the statement under the cursor with blanks, keeping every line and column
 * in place so an unfinished selection cannot stop the rest of the document parsing.
 */
function blankStatementAt(source: string, position: Position): string {
  const offset = positionOffset(source, position);
  if (offset === undefined) {
    return source;
  }
  const boundaries = [";", "{", "}"];
  let start = 0;
  for (let index = offset - 1; index >= 0; index--) {
    if (boundaries.includes(source[index] ?? "")) {
      start = index + 1;
      break;
    }
  }
  let end = source.length;
  for (let index = offset; index < source.length; index++) {
    if (boundaries.includes(source[index] ?? "")) {
      end = index;
      break;
    }
  }
  const blanked = source.slice(start, end).replace(/[^\n]/g, " ");
  return `${source.slice(0, start)}${blanked}${source.slice(end)}`;
}

function positionOffset(source: string, position: Position): number | undefined {
  const lines = source.split("\n");
  const line = lines[position.line];
  if (line === undefined || position.character < 0 || position.character > line.length) {
    return undefined;
  }
  return lines.slice(0, position.line).reduce((offset, current) => offset + current.length + 1, 0) + position.character;
}
