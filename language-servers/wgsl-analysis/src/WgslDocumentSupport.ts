import type { Position, Range } from "vscode-languageserver-protocol";
import type { WgslAnalysisDocument, WgslInferenceContext, WgslScope, WgslSymbol } from "./model.js";

export function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

export function splitTemplateArgumentText(name: string): string[] {
  const start = name.indexOf("<");
  if (start < 0 || !name.endsWith(">")) {
    return [];
  }
  const arguments_: string[] = [];
  let depth = 0;
  let argumentStart = start + 1;
  for (let index = argumentStart; index < name.length - 1; index++) {
    const character = name[index];
    if (character === "<") {
      depth += 1;
    } else if (character === ">") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      arguments_.push(name.slice(argumentStart, index).trim());
      argumentStart = index + 1;
    }
  }
  arguments_.push(name.slice(argumentStart, -1).trim());
  return arguments_.filter(Boolean);
}

function isValidPosition(source: string, position: Position): boolean {
  const lines = source.split("\n");
  const line = lines[position.line];
  return line !== undefined && position.character >= 0 && position.character <= line.length;
}

function rangeContains(range: Range, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) < 0;
}

function rangeContainsInclusiveEnd(range: Range, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) <= 0;
}

export function comparePosition(left: Position, right: Position): number {
  return left.line - right.line || left.character - right.character;
}

export function containsDocumentRange(outer: Range, inner: Range): boolean {
  return comparePosition(outer.start, inner.start) <= 0 && comparePosition(inner.end, outer.end) <= 0;
}

const SLANG_TO_WGSL_TYPE: Record<string, string> = {
  bool: "bool",
  float: "f32",
  float2: "vec2f",
  float3: "vec3f",
  float4: "vec4f",
  int: "i32",
  uint: "u32",
};

/** Maps a catalog slang type to its WGSL spelling, if it has a plain one. */
export function wgslHostGlobalType(slangType: string): string | undefined {
  return SLANG_TO_WGSL_TYPE[slangType.trim()];
}

/**
 * Splits the initializer off a declaration statement's source: the first `=`
 * outside any bracket pair that is not part of `==`, `!=`, `<=`, or `>=`.
 * Returns undefined when there is no initializer or it cannot be isolated.
 */
export function splitDeclarationInitializer(
  source: string,
  statement: { start: Position; end: Position },
): string | undefined {
  const text = sliceSourceLines(source, statement.start, statement.end).replace(/;\s*$/, "").trim();
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === "=" && depth === 0 && text[index + 1] !== "="
      && text[index - 1] !== "=" && text[index - 1] !== "!" && text[index - 1] !== "<" && text[index - 1] !== ">") {
      return text.slice(index + 1).trim() || undefined;
    }
  }
  return undefined;
}

function sliceSourceLines(source: string, start: Position, end: Position): string {
  const lines = source.split("\n");
  if (start.line === end.line) {
    return lines[start.line]?.slice(start.character, end.character) ?? "";
  }
  const parts: string[] = [lines[start.line]?.slice(start.character) ?? ""];
  for (let line = start.line + 1; line < end.line; line += 1) {
    parts.push(lines[line] ?? "");
  }
  parts.push(lines[end.line]?.slice(0, end.character) ?? "");
  return parts.join("\n");
}

export function symbolAtPosition(
  document: WgslAnalysisDocument,
  position: Position,
): WgslSymbol | null {
  if (!isValidPosition(document.source, position)) {
    return null;
  }
  for (const symbol of document.symbols) {
    if (rangeContains(symbol.declaration, position)) {
      return symbol;
    }
    if (symbol.references.some((reference) => rangeContains(reference, position))) {
      return symbol;
    }
  }
  return null;
}

export function visibleSymbolsAtPosition(
  document: WgslAnalysisDocument,
  position: Position,
): readonly WgslSymbol[] {
  if (!isValidPosition(document.source, position)) {
    return [];
  }
  const containingScopes = document.scopes
    .filter((scope) => rangeContainsInclusiveEnd(scope.range, position))
    .sort((left, right) => comparePosition(right.range.start, left.range.start));
  const innermost = containingScopes[0];
  if (!innermost) {
    return [];
  }
  const scopesById = new Map(document.scopes.map((scope) => [scope.id, scope]));
  const symbolsById = new Map(document.symbols.map((symbol) => [symbol.id, symbol]));
  const visible: WgslSymbol[] = [];
  const hiddenNames = new Set<string>();
  let scope: WgslScope | undefined = innermost;
  while (scope) {
    for (const symbolId of scope.symbolIds) {
      const symbol = symbolsById.get(symbolId);
      if (!symbol || comparePosition(symbol.declaration.start, position) > 0) {
        continue;
      }
      const hidesByName = symbol.kind !== "function";
      if (hidesByName && hiddenNames.has(symbol.name)) {
        continue;
      }
      visible.push(symbol);
      if (hidesByName) {
        hiddenNames.add(symbol.name);
      }
    }
    scope = scope.parentId ? scopesById.get(scope.parentId) : undefined;
  }
  return Object.freeze(visible);
}
