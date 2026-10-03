import type { Position, Range } from "vscode-languageserver-protocol";
import type {
  GlslAnalysisDocument,
  GlslScope,
  GlslSymbol
} from "./model.js";

export function symbolAtPosition(
  document: GlslAnalysisDocument,
  position: Position,
): GlslSymbol | null {
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
  document: GlslAnalysisDocument,
  position: Position,
): readonly GlslSymbol[] {
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
  const visible: GlslSymbol[] = [];
  const hiddenNames = new Set<string>();
  let scope: GlslScope | undefined = innermost;

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

function isValidPosition(source: string, position: Position): boolean {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character)) {
    return false;
  }
  const lines = source.split("\n");
  return position.line >= 0
    && position.line < lines.length
    && position.character >= 0
    && position.character <= lines[position.line].length;
}

function rangeContains(range: Range, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) < 0;
}

function rangeContainsInclusiveEnd(range: Range, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) <= 0;
}

export function rangeContainsRange(outer: Range, inner: Range): boolean {
  return comparePosition(outer.start, inner.start) <= 0
    && comparePosition(inner.end, outer.end) <= 0;
}

function comparePosition(left: Position, right: Position): number {
  return left.line === right.line ? left.character - right.character : left.line - right.line;
}

export function rangesEqual(left: Range, right: Range): boolean {
  return comparePosition(left.start, right.start) === 0 && comparePosition(left.end, right.end) === 0;
}

export function deduplicateRanges(ranges: readonly Range[]): Range[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function freezeRange(range: Range): Range {
  return Object.freeze({
    start: Object.freeze({ ...range.start }),
    end: Object.freeze({ ...range.end }),
  });
}

export function freezeDocument(document: GlslAnalysisDocument): GlslAnalysisDocument {
  const symbols = document.symbols.map((symbol) => Object.freeze({
    ...symbol,
    declaration: freezeRange(symbol.declaration),
    definition: freezeRange(symbol.definition),
    references: Object.freeze(symbol.references.map(freezeRange)),
  }));
  const scopes = document.scopes.map((scope) => Object.freeze({
    ...scope,
    range: freezeRange(scope.range),
    symbolIds: Object.freeze([...scope.symbolIds]),
  }));
  const diagnostics = document.diagnostics.map((diagnostic) => Object.freeze({
    ...diagnostic,
    range: freezeRange(diagnostic.range),
  }));
  const unresolvedReferences = document.unresolvedReferences.map((reference) => Object.freeze({
    ...reference,
    ranges: Object.freeze(reference.ranges.map(freezeRange)),
  }));
  return Object.freeze({
    ...document,
    symbols: Object.freeze(symbols),
    scopes: Object.freeze(scopes),
    diagnostics: Object.freeze(diagnostics),
    unresolvedReferences: Object.freeze(unresolvedReferences),
    originalToProcessed: Object.freeze([...document.originalToProcessed]),
    processedToOriginal: Object.freeze([...document.processedToOriginal]),
  });
}
