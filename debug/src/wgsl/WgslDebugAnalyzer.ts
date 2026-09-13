import type {
  DebugAnalysisResult,
  DebugCallable,
  DebugControlFlow,
  DebugDiagnostic,
  DebugSiteAnalysis,
  DebugSourcePosition,
  DebugSourceRange,
  DebugVisibleValue,
} from "@shader-studio/types";
import {
  parseWgslDocument,
  visibleSymbolsAtPosition,
  type WgslAnalysisDocument,
  type WgslStatement,
  type WgslSymbol,
} from "@shader-studio/wgsl-analysis";
import type { ShaderStage } from "@shader-studio/types";
import {
  comparePositions,
  containsPosition,
  containsRange,
  isWgslHostGlobalSymbol,
  offsetAt,
  rangeSize,
} from "./model";
import { isWgslMatrix2x2F32 } from "./WgslEmitter";

const CAPTURE_SCALARS = new Set(["bool", "i32", "u32", "f32", "f16"]);
const VECTOR_TYPE = /^vec([234])([fhiu])$/;
const VECTOR_PARAMETERIZED = /^vec([234])<\s*([iu]32|f32|f16)\s*>$/;

export function isWgslCapturableType(typeName: string): boolean {
  const trimmed = typeName.trim();
  return CAPTURE_SCALARS.has(trimmed) || VECTOR_TYPE.test(trimmed) || VECTOR_PARAMETERIZED.test(trimmed)
    || isWgslMatrix2x2F32(trimmed);
}

/**
 * Analyzes a WGSL debug site in an assembled source. The engine maps common
 * and pass ranges back to their original documents before exposing analysis.
 */
export function analyzeWgslSite(
  source: string,
  sourceUri: string,
  position: DebugSourcePosition,
  stage: ShaderStage = "fragment",
): DebugAnalysisResult {
  const document = parseWgslDocument(sourceUri, source, stage);
  const callableScope = innermostFunctionScope(document, position);
  const callableSymbol = callableScope
    ? document.symbols.find((symbol) => symbol.kind === "function" && symbol.name === callableScope.name
      && containsRange(callableScope.range, symbol.definition))
    : undefined;
  if (!callableScope || !callableSymbol) {
    return failure(sourceUri, position, "wgsl-debug-site-not-executed", siteMessage(source, sourceUri, position));
  }
  const statement = smallestContainingStatement(document, position)
    ?? nearestPrecedingStatement(document, position);
  if (!statement || !containsRange(callableScope.range, statement.range)) {
    return failure(sourceUri, position, "wgsl-debug-site-not-executed", siteMessage(source, sourceUri, position));
  }
  if (statement.kind === "if" || statement.kind === "switch" || statement.kind === "loop"
    || statement.kind === "for" || statement.kind === "while") {
    return analyzeControlFlowSite(document, sourceUri, position, statement, callableScope, callableSymbol);
  }
  return analyzeStatementSite(document, source, sourceUri, position, statement, callableScope, callableSymbol);
}

function analyzeStatementSite(
  document: WgslAnalysisDocument,
  source: string,
  sourceUri: string,
  position: DebugSourcePosition,
  statement: WgslStatement,
  callableScope: { range: DebugSourceRange },
  callableSymbol: WgslSymbol,
): DebugAnalysisResult {
  // Visibility is queried at the statement end so the statement's own
  // declaration is listed: after the statement runs, the value exists.
  const visible = visibleValuesAt(document, sourceUri, statement.range.end);
  const preview = previewValue(document, source, statement, visible);
  if (preview && !isWgslCapturableType(preview.typeName)) {
    return failure(
      sourceUri,
      position,
      "wgsl-debug-non-capturable-type",
      `WGSL debug capture does not support '${preview.typeName}'.`,
    );
  }
  const returnValue = statement.kind === "return"
    ? syntheticReturnValue(source, sourceUri, statement, callableSymbol)
    : undefined;
  const visibleValues = returnValue ? [...visible, returnValue] : visible;
  return {
    ok: true,
    analysis: {
      sourceUri,
      selectedRange: { start: { ...position }, end: { ...position } },
      statementRange: statement.range,
      containingCallable: toDebugCallable(document, callableSymbol, callableScope.range),
      visibleValues,
      controlFlow: enclosingControlFlow(document, statement),
      origin: { kind: "direct", writableRange: statement.range },
      previewValueId: returnValue?.id ?? preview?.id ?? null,
    },
  };
}

function analyzeControlFlowSite(
  document: WgslAnalysisDocument,
  sourceUri: string,
  position: DebugSourcePosition,
  statement: WgslStatement,
  callableScope: { range: DebugSourceRange },
  callableSymbol: WgslSymbol,
): DebugAnalysisResult {
  const visible = visibleValuesAt(document, sourceUri, statement.range.start);
  return {
    ok: true,
    analysis: {
      sourceUri,
      selectedRange: { start: { ...position }, end: { ...position } },
      statementRange: statement.range,
      containingCallable: toDebugCallable(document, callableSymbol, callableScope.range),
      visibleValues: visible,
      controlFlow: enclosingControlFlow(document, statement),
      origin: { kind: "direct", writableRange: statement.range },
      previewValueId: null,
    },
  };
}

/** Values visible at a boundary: params first, then declarations in order, shadowed names hidden. */
function visibleValuesAt(
  document: WgslAnalysisDocument,
  sourceUri: string,
  boundary: DebugSourcePosition,
): DebugVisibleValue[] {
  const values = visibleSymbolsAtPosition(document, boundary)
    .filter((symbol) => (symbol.kind === "variable" || symbol.kind === "parameter" || symbol.kind === "constant")
      && symbol.typeName !== undefined
      && isWgslCapturableType(symbol.typeName)
      // Host globals (iTime, iResolution, ...) type user code but are engine
      // state, not shader variables: listing them would flood every capture
      // with slots the other languages never show.
      && !isWgslHostGlobalSymbol(symbol))
    .map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      typeName: symbol.typeName ?? "f32",
      sourceUri,
      declarationRange: symbol.declaration,
      access: symbol.kind === "parameter" ? "read" as const : "readwrite" as const,
    }));
  // visibleSymbolsAtPosition walks innermost scope first; present parameters in
  // signature order, then declarations in source order like the Slang path.
  return values.sort((left, right) => {
    const leftParameter = isParameter(document, left.id);
    const rightParameter = isParameter(document, right.id);
    if (leftParameter !== rightParameter) {
      return leftParameter ? -1 : 1;
    }
    return comparePositions(left.declarationRange.start, right.declarationRange.start);
  });
}

function isParameter(document: WgslAnalysisDocument, id: string): boolean {
  return document.symbols.find((symbol) => symbol.id === id)?.kind === "parameter";
}

interface PreviewCandidate {
  readonly id: string;
  readonly name: string;
  readonly typeName: string;
}

function previewValue(
  document: WgslAnalysisDocument,
  source: string,
  statement: WgslStatement,
  visible: DebugVisibleValue[],
): PreviewCandidate | undefined {
  if (statement.kind === "declaration") {
    const symbol = document.symbols.find((candidate) => (candidate.kind === "variable" || candidate.kind === "constant")
      && candidate.typeName !== undefined
      && containsRange(statement.range, candidate.declaration));
    return symbol?.typeName === undefined
      ? undefined
      : { id: symbol.id, name: symbol.name, typeName: symbol.typeName };
  }
  if (statement.kind === "assignment" || statement.kind === "call") {
    const target = assignmentTarget(source, statement.range);
    return visible.find((value) => value.name === target);
  }
  return undefined;
}

function assignmentTarget(source: string, range: DebugSourceRange): string | undefined {
  const text = source.slice(offsetAt(source, range.start), offsetAt(source, range.end));
  return /^\s*([A-Za-z_]\w*)/.exec(text)?.[1];
}

function syntheticReturnValue(
  source: string,
  sourceUri: string,
  statement: WgslStatement,
  callableSymbol: WgslSymbol,
): DebugVisibleValue | undefined {
  const returnType = callableSymbol.typeName;
  if (!returnType || !isWgslCapturableType(returnType)) {
    return undefined;
  }
  const text = source.slice(offsetAt(source, statement.range.start), offsetAt(source, statement.range.end));
  const expression = /^\s*return\s+([\s\S]*?);?\s*$/.exec(text)?.[1]?.trim();
  if (!expression) {
    return undefined;
  }
  return {
    id: `return:${sourceUri}:${statement.range.start.line}:${statement.range.start.character}`,
    name: "_dbgReturn",
    typeName: returnType,
    sourceUri,
    declarationRange: statement.range,
    access: "read",
  };
}

function innermostFunctionScope(
  document: WgslAnalysisDocument,
  position: DebugSourcePosition,
): WgslAnalysisDocument["scopes"][number] | undefined {
  return document.scopes
    .filter((scope) => scope.kind === "function" && containsPosition(scope.range, position))
    .sort((left, right) => rangeSize(left.range) - rangeSize(right.range))[0];
}

function smallestContainingStatement(
  document: WgslAnalysisDocument,
  position: DebugSourcePosition,
): WgslStatement | undefined {
  return document.statements
    .filter((statement) => containsPosition(statement.range, position))
    .sort((left, right) => rangeSize(left.range) - rangeSize(right.range))[0];
}

function nearestPrecedingStatement(
  document: WgslAnalysisDocument,
  position: DebugSourcePosition,
): WgslStatement | undefined {
  return document.statements
    .filter((statement) => comparePositions(statement.range.end, position) <= 0)
    .sort((left, right) => comparePositions(right.range.end, left.range.end))[0];
}

function enclosingControlFlow(document: WgslAnalysisDocument, statement: WgslStatement): DebugControlFlow[] {
  const kinds = new Set(["if", "switch", "loop", "for", "while"]);
  return document.statements
    .filter((candidate) => kinds.has(candidate.kind) && containsRange(candidate.range, statement.range))
    .sort((left, right) => comparePositions(left.range.start, right.range.start))
    .map((candidate) => ({ kind: candidate.kind as DebugControlFlow["kind"], range: candidate.range }));
}

function toDebugCallable(
  document: WgslAnalysisDocument,
  symbol: WgslSymbol,
  bodyRange: DebugSourceRange,
): DebugCallable {
  void document;
  return {
    id: symbol.id,
    name: symbol.name,
    kind: "free",
    ownerType: null,
    returnTypeName: symbol.typeName ?? "void",
    signatureRange: symbol.declaration,
    bodyRange,
  };
}

function siteMessage(source: string, sourceUri: string, position: DebugSourcePosition): string {
  const sourceLine = source.split("\n")[position.line]?.trim() ?? "(unknown)";
  return `Not an executable statement (L${position.line + 1}: "${sourceLine.slice(0, 40)}" in ${sourceUri})`;
}

function failure(
  sourceUri: string,
  position: DebugSourcePosition,
  code: DebugDiagnostic["code"],
  message: string,
): DebugAnalysisResult {
  return { ok: false, diagnostics: [{ code, message, sourceUri, range: { start: position, end: { ...position } } }] };
}

