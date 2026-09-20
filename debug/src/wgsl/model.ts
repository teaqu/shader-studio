import type { DebugSourcePosition, DebugSourceRange } from "@shader-studio/types";
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
    if (line === position.line && character === position.character) {
      return offset;
    }
    if (source[offset] === "\n") {
      line += 1; character = 0; 
    } else {
      character += 1;
    }
  }
  return source.length;
}
