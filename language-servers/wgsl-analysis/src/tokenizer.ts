/**
 * WGSL tokenizer. There is no preprocessor and no string-literal dialect to
 * speak of, so this is a single pass: identifiers, keywords, numeric literals,
 * punctuation, and the `@` attribute introducer. Block comments nest in WGSL
 * (unlike C), so a depth counter replaces the usual non-nesting scan.
 */

export type WgslTokenKind =
  | "identifier"
  | "keyword"
  | "intLiteral"
  | "floatLiteral"
  | "punctuation"
  | "attribute"
  | "unknown"
  | "eof";

export interface WgslToken {
  readonly kind: WgslTokenKind;
  readonly text: string;
  /** Byte offset of the first character. */
  readonly offset: number;
  /** Zero-based line number. */
  readonly line: number;
  /** Zero-based UTF-16 column. */
  readonly character: number;
}

const KEYWORDS = new Set([
  "alias", "break", "case", "const", "const_assert", "continue", "continuing",
  "default", "diagnostic", "discard", "else", "enable", "false", "fn", "for",
  "if", "let", "loop", "override", "requires", "return", "struct", "switch",
  "true", "var", "while",
]);

const MULTI_CHAR_PUNCTUATION = [
  "<<=", ">>=", "->", "==", "!=", "<=", ">=", "&&", "||", "<<", ">>",
  "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
];

const INT_LITERAL = /^(?:0[xX][0-9a-fA-F]+|\d+)(?:[iu])?/;
const FLOAT_LITERAL = /^(?:0[xX][0-9a-fA-F]*\.?[0-9a-fA-F]*(?:[pP][+-]?\d+[fh]?)?|\d+\.\d*(?:[eE][+-]?\d+)?[fh]?|\d+[eE][+-]?\d+[fh]?|\.\d+(?:[eE][+-]?\d+)?[fh]?|\d+[fh])/;

const SINGLE_CHAR_PUNCTUATION = new Set("(){}[]<>,.;:=+-*/%&|^!~?".split(""));

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

export function tokenizeWgsl(source: string): WgslToken[] {
  const tokens: WgslToken[] = [];
  let offset = 0;
  let line = 0;
  let character = 0;

  const push = (kind: WgslTokenKind, text: string, startOffset: number, startLine: number, startCharacter: number): void => {
    tokens.push({ kind, text, offset: startOffset, line: startLine, character: startCharacter });
  };

  const advance = (text: string): void => {
    for (const char of text) {
      if (char === "\n") {
        line += 1;
        character = 0;
      } else {
        character += 1;
      }
    }
    offset += text.length;
  };

  while (offset < source.length) {
    const rest = source.slice(offset);
    const char = rest[0] ?? "";

    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      advance(char);
      continue;
    }
    if (rest.startsWith("//")) {
      const end = rest.indexOf("\n");
      advance(end === -1 ? rest : rest.slice(0, end));
      continue;
    }
    if (rest.startsWith("/*")) {
      let depth = 0;
      let index = 0;
      while (index < rest.length) {
        if (rest.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (rest.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
          if (depth === 0) {
            break;
          }
        } else {
          index += 1;
        }
      }
      advance(rest.slice(0, index));
      continue;
    }
    if (char === "@") {
      push("attribute", "@", offset, line, character);
      advance("@");
      continue;
    }
    if (isIdentifierStart(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0] ?? char;
      push(KEYWORDS.has(match) ? "keyword" : "identifier", match, offset, line, character);
      advance(match);
      continue;
    }
    const floatMatch = FLOAT_LITERAL.exec(rest);
    // A float match that is only an integer prefix (no dot, exponent, or
    // suffix) belongs to the integer rule below. Hex digits include `e`, so
    // hex literals need their own test: only a dot, binary exponent, or f/h
    // suffix makes them floats.
    const isFloat = floatMatch?.[0] !== undefined && (/^0[xX]/.test(floatMatch[0])
      ? /[.pP]/.test(floatMatch[0])
      : /[.eEfh]/.test(floatMatch[0]));
    if (floatMatch?.[0] && isFloat) {
      push("floatLiteral", floatMatch[0], offset, line, character);
      advance(floatMatch[0]);
      continue;
    }
    const intMatch = INT_LITERAL.exec(rest);
    if (intMatch?.[0]) {
      push("intLiteral", intMatch[0], offset, line, character);
      advance(intMatch[0]);
      continue;
    }
    if (floatMatch?.[0]) {
      push("intLiteral", floatMatch[0], offset, line, character);
      advance(floatMatch[0]);
      continue;
    }
    const multi = MULTI_CHAR_PUNCTUATION.find((candidate) => rest.startsWith(candidate));
    if (multi) {
      push("punctuation", multi, offset, line, character);
      advance(multi);
      continue;
    }
    push(SINGLE_CHAR_PUNCTUATION.has(char) ? "punctuation" : "unknown", char, offset, line, character);
    advance(char);
  }

  push("eof", "", offset, line, character);
  return tokens;
}
