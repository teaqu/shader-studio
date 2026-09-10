import type { DebugSourcePosition, DebugSourceRange } from "@shader-studio/types";
import {
  SHADER_STUDIO_BUILTIN_UNIFORMS,
  SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS,
} from "@shader-studio/types";
import type {
  WgslAnalysisDocument,
  WgslStatement,
  WgslSymbol,
} from "@shader-studio/wgsl-analysis";

export type {
  WgslAnalysisDocument,
  WgslStatement,
  WgslSymbol,
};

const WGSL_HOST_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  ...SHADER_STUDIO_BUILTIN_UNIFORMS
    .filter((entry) => entry.languages.includes("wgsl"))
    .map((entry) => entry.name),
  ...SHADER_STUDIO_FRAGMENT_CONTEXT_SYMBOLS
    .filter((entry) => entry.languages.includes("wgsl"))
    .map((entry) => entry.name),
]);

/**
 * Whether a symbol is a synthetic host global seeded by the analyzer
 * (zero-range declaration at the file origin with a catalog name), as opposed
 * to a user declaration that merely shares the name.
 */
export function isWgslHostGlobalSymbol(symbol: WgslSymbol): boolean {
  return WGSL_HOST_GLOBAL_NAMES.has(symbol.name)
    && symbol.declaration.start.line === 0 && symbol.declaration.start.character === 0
    && symbol.declaration.end.line === 0 && symbol.declaration.end.character === 0;
}

/** Shared line/character geometry over analysis ranges. No parser lives here. */
export function comparePositions(left: DebugSourcePosition, right: DebugSourcePosition): number {
  return left.line - right.line || left.character - right.character;
}

export function containsPosition(range: DebugSourceRange, position: DebugSourcePosition): boolean {
  return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) <= 0;
}

export function containsRange(outer: DebugSourceRange, inner: DebugSourceRange): boolean {
  return comparePositions(outer.start, inner.start) <= 0 && comparePositions(inner.end, outer.end) <= 0;
}

export function rangeSize(range: DebugSourceRange): number {
  return (range.end.line - range.start.line) * 100000 + range.end.character - range.start.character;
}

export function offsetAt(source: string, position: DebugSourcePosition): number {
  let line = 0;
  let character = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    if (line === position.line && character === position.character) return offset;
    if (source[offset] === "\n") { line += 1; character = 0; } else character += 1;
  }
  return source.length;
}
