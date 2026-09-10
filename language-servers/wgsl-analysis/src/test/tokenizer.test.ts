import { describe, expect, it } from "vitest";
import { tokenizeWgsl } from "../tokenizer";

function texts(source: string): string[] {
  return tokenizeWgsl(source).filter((token) => token.kind !== "eof").map((token) => token.text);
}

describe("tokenizeWgsl", () => {
  it("tokenizes a minimal function", () => {
    const tokens = tokenizeWgsl("fn main() {}");

    expect(texts("fn main() {}")).toEqual(["fn", "main", "(", ")", "{", "}"]);
    expect(tokens[0]).toMatchObject({ kind: "keyword", line: 0, character: 0 });
    expect(tokens[1]).toMatchObject({ kind: "identifier", line: 0, character: 3 });
  });

  it("tracks line and column across newlines", () => {
    const tokens = tokenizeWgsl("var a: f32;\nvar b: f32;");

    expect(tokens.find((token) => token.text === "b")).toMatchObject({ line: 1, character: 4 });
  });

  it("skips line comments", () => {
    expect(texts("var a: f32; // the answer\nvar b: f32;")).toEqual(
      ["var", "a", ":", "f32", ";", "var", "b", ":", "f32", ";"],
    );
  });

  it("skips block comments, including nested ones", () => {
    expect(texts("var /* outer /* inner */ still outer */ a: f32;")).toEqual(
      ["var", "a", ":", "f32", ";"],
    );
    expect(texts("var /* level1 /* level2 /* level3 */ back2 */ back1 */ a: f32;")).toEqual(
      ["var", "a", ":", "f32", ";"],
    );
  });

  it("keeps tokens before an unterminated block comment and then ends", () => {
    const tokens = tokenizeWgsl("var a: f32; /* never ends");

    expect(texts("var a: f32; /* never ends")).toEqual(["var", "a", ":", "f32", ";"]);
    expect(tokens[tokens.length - 1]).toMatchObject({ kind: "eof" });
  });

  it("distinguishes keywords from identifiers", () => {
    const tokens = tokenizeWgsl("fn struct alias enable requires diagnostic override const_assert true false myFn");

    expect(tokens.map((token) => token.kind)).toEqual([
      "keyword", "keyword", "keyword", "keyword", "keyword", "keyword",
      "keyword", "keyword", "keyword", "keyword", "identifier", "eof",
    ]);
  });

  it("tokenizes decimal and hexadecimal integer literals", () => {
    const tokens = tokenizeWgsl("1 42 0 0x1F 0Xff 123i 45u");

    expect(tokens.map((token) => token.kind)).toEqual(
      ["intLiteral", "intLiteral", "intLiteral", "intLiteral", "intLiteral", "intLiteral", "intLiteral", "eof"],
    );
    expect(tokens.map((token) => token.text)).toContain("0x1F");
  });

  it("tokenizes float literals with exponents and f/h suffixes", () => {
    const tokens = tokenizeWgsl("1.0 0.5 1e3 1.5e-3 2f 3h 0x1p3");

    expect(tokens.map((token) => token.kind)).toEqual(
      ["floatLiteral", "floatLiteral", "floatLiteral", "floatLiteral", "floatLiteral", "floatLiteral", "floatLiteral", "eof"],
    );
  });

  it("tokenizes multi-character punctuation", () => {
    expect(texts("-> == != <= >= && || << >> += -= *= /= %= &= |= ^= <<= >>=")).toEqual(
      ["->", "==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="],
    );
  });

  it("tokenizes the attribute introducer", () => {
    const tokens = tokenizeWgsl("@group(0)");

    expect(tokens[0]).toMatchObject({ kind: "attribute", text: "@" });
  });

  it("marks unexpected characters without dropping the rest", () => {
    const tokens = tokenizeWgsl("var a: f32; # var b: f32;");

    expect(tokens.find((token) => token.text === "#")).toMatchObject({ kind: "unknown" });
    expect(tokens.filter((token) => token.text === "var")).toHaveLength(2);
  });

  it("always terminates with a single eof token", () => {
    for (const source of ["", "   ", "// only a comment", "fn f() {}"]) {
      const tokens = tokenizeWgsl(source);
      expect(tokens[tokens.length - 1]).toMatchObject({ kind: "eof" });
      expect(tokens.filter((token) => token.kind === "eof")).toHaveLength(1);
    }
  });
});
