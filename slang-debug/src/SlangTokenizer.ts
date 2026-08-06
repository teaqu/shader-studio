import type { DebugDiagnostic, DebugSourcePosition, DebugSourceRange } from "@shader-studio/types";
import type { SlangToken, SlangTokenDocument, SlangTokenKind } from "./tokens";

const punctuationCharacters = new Set("(){}[];,.:?<>".split(""));
const operatorCharacters = new Set("+-*/%=!&|^~".split(""));

export function tokenizeSlang(sourceUri: string, source: string): SlangTokenDocument {
  const tokens: SlangToken[] = [];
  const diagnostics: DebugDiagnostic[] = [];
  let offset = 0;
  let position: DebugSourcePosition = { line: 0, character: 0 };
  let atLineStart = true;

  const emit = (kind: SlangTokenKind, startOffset: number, start: DebugSourcePosition): void => {
    const text = source.slice(startOffset, offset);
    const range = { start, end: { ...position } };
    tokens.push({ kind, text, sourceUri, startOffset, endOffset: offset, range });
  };

  const emitUnsupportedSyntax = (message: string, range: DebugSourceRange): void => {
    diagnostics.push({ code: "slang-debug-unsupported-syntax", message, sourceUri, range });
  };

  const advance = (): void => {
    if (source[offset] === "\r" && source[offset + 1] === "\n") {
      offset += 2;
      position = { line: position.line + 1, character: 0 };
      atLineStart = true;
      return;
    }

    if (source[offset] === "\n" || source[offset] === "\r") {
      offset += 1;
      position = { line: position.line + 1, character: 0 };
      atLineStart = true;
      return;
    }

    const remainsAtLineStart = atLineStart && (source[offset] === " " || source[offset] === "\t");
    offset += 1;
    position = { line: position.line, character: position.character + 1 };
    atLineStart = remainsAtLineStart;
  };

  const advanceWhile = (predicate: (character: string) => boolean): void => {
    while (offset < source.length && predicate(source[offset])) {
      advance();
    }
  };

  while (offset < source.length) {
    const startOffset = offset;
    const start = { ...position };
    const character = source[offset];

    if (isWhitespace(character)) {
      advanceWhile(isWhitespace);
      emit("whitespace", startOffset, start);
      continue;
    }

    if (character === "#" && atLineStart) {
      scanPreprocessorDirective(source, () => offset, advance);
      emit("preprocessor", startOffset, start);
      continue;
    }

    if (character === "/" && source[offset + 1] === "/") {
      advance();
      advance();
      advanceWhile((next) => next !== "\r" && next !== "\n");
      emit("comment", startOffset, start);
      continue;
    }

    if (character === "/" && source[offset + 1] === "*") {
      advance();
      advance();
      while (offset < source.length && !(source[offset] === "*" && source[offset + 1] === "/")) {
        advance();
      }
      const terminated = offset < source.length;
      if (terminated) {
        advance();
        advance();
      }
      emit("comment", startOffset, start);
      if (!terminated) {
        emitUnsupportedSyntax("Unterminated block comment.", { start, end: { ...position } });
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      const quote = character;
      advance();
      let terminated = false;
      while (offset < source.length) {
        if (source[offset] === "\\") {
          advance();
          if (offset < source.length) {
            advance();
          }
          continue;
        }
        if (source[offset] === quote) {
          advance();
          terminated = true;
          break;
        }
        if (source[offset] === "\r" || source[offset] === "\n") {
          break;
        }
        advance();
      }
      emit("string", startOffset, start);
      if (!terminated) {
        emitUnsupportedSyntax("Unterminated string literal.", { start, end: { ...position } });
      }
      continue;
    }

    if (isIdentifierStart(character)) {
      advance();
      advanceWhile(isIdentifierPart);
      emit("identifier", startOffset, start);
      continue;
    }

    if (isDigit(character)) {
      advance();
      advanceWhile(isNumberPart);
      emit("number", startOffset, start);
      continue;
    }

    if (punctuationCharacters.has(character)) {
      advance();
      emit("punctuation", startOffset, start);
      continue;
    }

    if (operatorCharacters.has(character)) {
      advance();
      while (offset < source.length && operatorCharacters.has(source[offset])) {
        advance();
      }
      emit("operator", startOffset, start);
      continue;
    }

    advance();
    emit("unknown", startOffset, start);
  }

  return { sourceUri, source, tokens, diagnostics };
}

function scanPreprocessorDirective(
  source: string,
  currentOffset: () => number,
  advance: () => void,
): void {
  while (currentOffset() < source.length) {
    let lineEnd = currentOffset();
    while (lineEnd < source.length && source[lineEnd] !== "\r" && source[lineEnd] !== "\n") {
      lineEnd += 1;
    }
    const continues = source[lineEnd - 1] === "\\";
    while (currentOffset() < lineEnd) {
      advance();
    }
    if (currentOffset() < source.length) {
      advance();
    }
    if (!continues) {
      return;
    }
  }
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\r" || character === "\n" || character === "\f";
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

function isDigit(character: string): boolean {
  return /[0-9]/.test(character);
}

function isNumberPart(character: string): boolean {
  return /[A-Za-z0-9_.]/.test(character);
}
