import type { DebugSourceRange } from "@shader-studio/types";
import type { SlangToken,SlangTokenDocument } from "./tokens";

/** Token navigation and source-position helpers shared by structural passes. */
export function previousStatementBoundary(tokens: SlangToken[], index: number): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if ([";", "{", "}"].includes(tokens[cursor].text)) {
      return cursor;
    }
  }
  return -1;
}

export function previousBoundary(tokens: SlangToken[], index: number): number {
  return previousStatementBoundary(tokens, index);
}

export function splitTopLevelSegments(tokens: SlangToken[], startIndex: number, endIndex: number, separator: string): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  let start = startIndex;
  let depth = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    if (["(", "[", "{", "<"].includes(tokens[index].text)) {
      depth += 1;
    } else if ([")", "]", "}", ">"].includes(tokens[index].text)) {
      depth -= 1;
    } else if (tokens[index].text === separator && depth === 0) {
      segments.push([start, index]); start = index + 1; 
    }
  }
  segments.push([start, endIndex]);
  return segments;
}

export function splitTokenText(document: SlangTokenDocument, tokens: SlangToken[], startIndex: number, endIndex: number): string[] {
  if (startIndex >= endIndex) {
    return [];
  }
  return splitTopLevelSegments(tokens, startIndex, endIndex, ",")
    .map(([start, end]) => normalizedText(document, tokens, start, end)).filter(Boolean);
}

export function normalizedText(document: SlangTokenDocument, tokens: SlangToken[], startIndex: number, endIndex: number): string {
  if (startIndex >= endIndex) {
    return "";
  }
  let text = tokens[startIndex].text;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    text += `${tokens[index - 1].endOffset < tokens[index].startOffset ? " " : ""}${tokens[index].text}`;
  }
  return text;
}

export function findNextToken(tokens: SlangToken[], startIndex: number, wanted: string, stop?: string): number | undefined {
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (tokens[index].text === wanted || (stop && tokens[index].text === stop)) {
      return index;
    }
  }
  return undefined;
}

export function findMatchingText(tokens: SlangToken[], openIndex: number, openText: string, closeText: string): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].text === openText) {
      depth += 1;
    } else if (tokens[index].text === closeText && --depth === 0) {
      return index;
    }
  }
  return undefined;
}

export function findTokenInRange(tokens: SlangToken[], startIndex: number, endIndex: number, text: string): number | undefined {
  for (let index = startIndex; index < endIndex; index += 1) {
    if (tokens[index].text === text) {
      return index;
    }
  }
  return undefined;
}

export function findDeclarationName(tokens: SlangToken[], startIndex: number, endIndex: number): number | undefined {
  let depth = 0; let candidate: number | undefined;
  for (let index = startIndex; index < endIndex; index += 1) {
    if (["<", "[", "("].includes(tokens[index].text)) {
      depth += 1;
    } else if ([">", "]", ")"].includes(tokens[index].text)) {
      depth -= 1;
    } else if (depth === 0 && tokens[index].kind === "identifier") {
      candidate = index;
    }
  }
  return candidate;
}

export function isExplicitTypeTokenSequence(tokens: SlangToken[]): boolean {
  if (tokens.length === 0 || tokens[0].kind !== "identifier") {
    return false;
  }
  const last = tokens[tokens.length - 1];
  return (last.kind === "identifier" || [">", "]", "*", "&"].includes(last.text))
    && tokens.every((token) => token.kind === "identifier" || token.kind === "number" || ["<", ">", ",", ".", "[", "]", "*", "&"].includes(token.text));
}

export function arraySuffixText(document: SlangTokenDocument, tokens: SlangToken[], startIndex: number, endIndex: number): string | null {
  if (startIndex === endIndex) {
    return "";
  }
  let cursor = startIndex;
  while (cursor < endIndex) {
    if (tokens[cursor].text !== "[") {
      return null;
    }
    const close = findMatchingText(tokens, cursor, "[", "]");
    if (close === undefined || close >= endIndex) {
      return null;
    }
    cursor = close + 1;
  }
  return normalizedText(document, tokens, startIndex, endIndex).replace(/\s+/g, "");
}

export function findTopLevelToken(tokens: SlangToken[], startIndex: number, endIndex: number, text: string): number | undefined {
  let depth = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    if (["(", "[", "{", "<"].includes(tokens[index].text)) {
      depth += 1;
    } else if ([")", "]", "}", ">"].includes(tokens[index].text)) {
      depth -= 1;
    } else if (depth === 0 && tokens[index].text === text) {
      return index;
    }
  }
  return undefined;
}

export function moduleScopeId(document: SlangTokenDocument): string {
  return `scope:${document.sourceUri}:0:0`; 
}
export function rangeStartOffset(document: SlangTokenDocument, range: DebugSourceRange): number {
  return offsetAt(document.source, range.start); 
}
export function rangeEndOffset(document: SlangTokenDocument, range: DebugSourceRange): number {
  return offsetAt(document.source, range.end); 
}
function offsetAt(source: string, target: { line: number; character: number }): number {
  let line = 0; let character = 0;
  for (let offset = 0; offset < source.length; offset += 1) {
    if (line === target.line && character === target.character) {
      return offset;
    }
    if (source[offset] === "\r" && source[offset + 1] === "\n") {
      offset += 1; line += 1; character = 0; 
    } else if (source[offset] === "\r" || source[offset] === "\n") {
      line += 1; character = 0; 
    } else {
      character += 1;
    }
  }
  return source.length;
}
export function offsetForPosition(document: SlangTokenDocument, position: { line: number; character: number }, _tokens: SlangToken[]): number {
  return offsetAt(document.source, position); 
}
export function stableId(prefix: string, token: SlangToken): string {
  return `${prefix}:${token.sourceUri}:${token.range.start.line}:${token.range.start.character}`; 
}
