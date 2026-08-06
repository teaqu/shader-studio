import type {
  DebugAnalysisResult,
  DebugCallable,
  DebugControlFlow,
  DebugDiagnostic,
  DebugOrigin,
  DebugSourcePosition,
  DebugSourceRange,
  DebugVisibleValue,
} from "@shader-studio/types";
import type { SlangCallableNode, SlangDeclarationNode, SlangScopeNode, SlangStatementNode } from "./model";
import type { SlangWorkspaceFile } from "./SlangWorkspace";

const captureTypeNames = new Set(["float", "float2", "float3", "float4", "int", "bool", "float2x2"]);

export function isSlangCapturableType(typeName: string): boolean {
  return captureTypeNames.has(typeName);
}

export function analyzeSlangSite(file: SlangWorkspaceFile, position: DebugSourcePosition): DebugAnalysisResult {
  const statement = smallestContainingStatement(file, position);
  if (!statement) {
    return failure(file.source.uri, position, "slang-debug-site-not-executed", "The selected Slang location is not an executable statement.");
  }
  const callable = containingCallable(file, statement);
  if (!callable) {
    return failure(file.source.uri, position, "slang-debug-site-not-executed", "The selected Slang statement is not inside a callable body.");
  }
  const visibleDeclarations = visibleDeclarationsAt(file, statement, callable);
  const declaredValues = visibleDeclarations
    .filter((declaration) => isSlangCapturableType(declaration.typeName))
    .map(toVisibleValue);
  const returnValue = syntheticReturnValue(file, statement, callable);
  const visibleValues = returnValue ? [...declaredValues, returnValue] : declaredValues;
  const preview = previewDeclaration(file, statement, callable, visibleDeclarations);
  if (preview && !isSlangCapturableType(preview.typeName)) {
    return failure(
      file.source.uri,
      position,
      "slang-debug-non-capturable-type",
      `Slang debug capture does not support '${preview.typeName}'.`,
    );
  }
  return {
    ok: true,
    analysis: {
      sourceUri: file.source.uri,
      selectedRange: { start: { ...position }, end: { ...position } },
      statementRange: statement.range,
      containingCallable: toDebugCallable(callable),
      visibleValues,
      controlFlow: [...file.structure.controlFlows.values()]
        .filter((control) => containsRange(control.range, statement.range))
        .sort((left, right) => comparePositions(left.range.start, right.range.start))
        .map((control) => ({ kind: control.kind, range: control.range })),
      origin: originForStatement(file, statement),
      previewValueId: returnValue?.id ?? preview?.id ?? null,
    },
  };
}

function smallestContainingStatement(file: SlangWorkspaceFile, position: DebugSourcePosition): SlangStatementNode | undefined {
  return [...file.structure.statements.values()]
    .filter((statement) => containsPosition(statement.range, position))
    .sort((left, right) => rangeSize(left.range) - rangeSize(right.range))[0];
}

function containingCallable(file: SlangWorkspaceFile, statement: SlangStatementNode): SlangCallableNode | undefined {
  return [...file.structure.callables.values()]
    .filter((callable) => containsRange(callable.bodyRange, statement.range))
    .sort((left, right) => rangeSize(left.bodyRange) - rangeSize(right.bodyRange))[0];
}

function visibleDeclarationsAt(
  file: SlangWorkspaceFile,
  statement: SlangStatementNode,
  callable: SlangCallableNode,
): SlangDeclarationNode[] {
  const scopes = scopeAncestry(file, statement.scopeId);
  const scopeDepth = new Map(scopes.map((scope, index) => [scope.id, index]));
  const parameterIds = new Set(callable.parameters.map((parameter) => parameter.id));
  const candidates = [...file.structure.declarations.values()]
    .filter((declaration) => scopeDepth.has(declaration.scopeId))
    .filter((declaration) => parameterIds.has(declaration.id)
      || comparePositions(declaration.statementRange.start, statement.range.start) <= 0)
    .sort((left, right) => {
      const depth = scopeDepth.get(left.scopeId)! - scopeDepth.get(right.scopeId)!;
      return depth || comparePositions(right.range.start, left.range.start);
    });
  const names = new Set<string>();
  return candidates.filter((declaration) => {
    if (names.has(declaration.name)) return false;
    names.add(declaration.name);
    return true;
  }).sort((left, right) => {
    const leftParameter = parameterIds.has(left.id);
    const rightParameter = parameterIds.has(right.id);
    if (leftParameter !== rightParameter) return leftParameter ? -1 : 1;
    return comparePositions(left.range.start, right.range.start);
  });
}

function previewDeclaration(
  file: SlangWorkspaceFile,
  statement: SlangStatementNode,
  callable: SlangCallableNode,
  declarations: SlangDeclarationNode[],
): SlangDeclarationNode | undefined {
  const declared = declarations.find((declaration) => sameRange(declaration.statementRange, statement.range));
  if (declared) return declared;
  const identifier = assignmentTarget(file, statement.range);
  if (identifier) return declarations.find((declaration) => declaration.name === identifier);
  return undefined;
}

function assignmentTarget(file: SlangWorkspaceFile, range: DebugSourceRange): string | undefined {
  const tokens = file.preprocessor.activeTokens.filter((token) => containsRange(range, token.range));
  const equals = tokens.findIndex((token) => token.text === "=");
  if (equals < 1) return undefined;
  for (let index = equals - 1; index >= 0; index -= 1) {
    if (tokens[index].kind === "identifier") return tokens[index].text;
  }
  return undefined;
}

function syntheticReturnValue(
  file: SlangWorkspaceFile,
  statement: SlangStatementNode,
  callable: SlangCallableNode,
): DebugVisibleValue | undefined {
  if (statement.kind !== "return" || !isSlangCapturableType(callable.returnTypeName)) return undefined;
  const statementStart = offsetAt(file.source.source, statement.range.start);
  const statementEnd = offsetAt(file.source.source, statement.range.end);
  const expression = file.source.source.slice(statementStart, statementEnd)
    .match(/^\s*return\s+([\s\S]*?);?\s*$/)?.[1]?.trim();
  if (!expression) return undefined;
  return {
    id: `return:${file.source.uri}:${statement.range.start.line}:${statement.range.start.character}`,
    name: "_dbgReturn",
    typeName: callable.returnTypeName,
    sourceUri: file.source.uri,
    declarationRange: statement.range,
    access: "read",
  };
}

function scopeAncestry(file: SlangWorkspaceFile, scopeId: string): SlangScopeNode[] {
  const scopes: SlangScopeNode[] = [];
  let current = file.structure.scopes.get(scopeId);
  while (current) {
    scopes.push(current);
    current = current.parentId ? file.structure.scopes.get(current.parentId) : undefined;
  }
  return scopes;
}

function originForStatement(file: SlangWorkspaceFile, statement: SlangStatementNode): DebugOrigin {
  return [...file.structure.declarations.values()].find((declaration) => sameRange(declaration.statementRange, statement.range))?.origin
    ?? { kind: "direct", writableRange: statement.range };
}

function toVisibleValue(declaration: SlangDeclarationNode): DebugVisibleValue {
  return {
    id: declaration.id,
    name: declaration.name,
    typeName: declaration.typeName,
    sourceUri: declaration.sourceUri,
    declarationRange: declaration.range,
    access: declaration.access,
  };
}

function toDebugCallable(callable: SlangCallableNode): DebugCallable {
  return {
    id: callable.id,
    name: callable.name,
    kind: callable.kind,
    ownerType: callable.ownerType,
    returnTypeName: callable.returnTypeName,
    signatureRange: callable.signatureRange,
    bodyRange: callable.bodyRange,
  };
}

function failure(
  sourceUri: string,
  position: DebugSourcePosition,
  code: DebugDiagnostic["code"],
  message: string,
): DebugAnalysisResult {
  return { ok: false, diagnostics: [{ code, message, sourceUri, range: { start: position, end: { ...position } } }] };
}

function containsPosition(range: DebugSourceRange, position: DebugSourcePosition): boolean {
  return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) <= 0;
}

function containsRange(outer: DebugSourceRange, inner: DebugSourceRange): boolean {
  return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0;
}

function sameRange(left: DebugSourceRange, right: DebugSourceRange): boolean {
  return comparePositions(left.start, right.start) === 0 && comparePositions(left.end, right.end) === 0;
}

function comparePositions(left: DebugSourcePosition, right: DebugSourcePosition): number {
  return left.line - right.line || left.character - right.character;
}

function rangeSize(range: DebugSourceRange): number {
  return (range.end.line - range.start.line) * 100000 + range.end.character - range.start.character;
}

function offsetAt(source: string, position: DebugSourcePosition): number {
  let line = 0;
  let character = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    if (line === position.line && character === position.character) return offset;
    if (source[offset] === "\n") { line += 1; character = 0; } else character += 1;
  }
  return source.length;
}
