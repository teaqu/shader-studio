import { describe, expect, it } from "vitest";
import { tokenizeSlang } from "../SlangTokenizer";

describe("tokenizeSlang", () => {
  // Mutation caught: splitting comments, strings, or continued directives would expose their braces/quotes.
  it("preserves Slang syntax as exact atomic tokens with zero-based ranges", () => {
    const source = "module demo;\n"
      + "import gfx;\n"
      + "[Attr]\n"
      + "struct Box<T> { T value; } // { ignored }\n"
      + "interface I { }\n"
      + "extension Box<float> { }\n"
      + "float f = \"a\\\"b\";\n"
      + "Foo<Bar<Baz>> x;\n"
      + "#define SUM(a, b) a + \\\n"
      + "  b\n";

    const document = tokenizeSlang("file:///workspace/main.slang", source);
    const tokens = document.tokens.map((token) => ({
      kind: token.kind,
      text: token.text,
      sourceUri: token.sourceUri,
      startOffset: token.startOffset,
      endOffset: token.endOffset,
      range: token.range,
    }));

    expect(tokens).toEqual(expect.arrayContaining([
      {
        kind: "identifier", text: "module", sourceUri: "file:///workspace/main.slang",
        startOffset: 0, endOffset: 6,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      },
      {
        kind: "identifier", text: "import", sourceUri: "file:///workspace/main.slang",
        startOffset: 13, endOffset: 19,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
      },
      {
        kind: "identifier", text: "struct", sourceUri: "file:///workspace/main.slang",
        startOffset: 32, endOffset: 38,
        range: { start: { line: 3, character: 0 }, end: { line: 3, character: 6 } },
      },
      {
        kind: "comment", text: "// { ignored }", sourceUri: "file:///workspace/main.slang",
        startOffset: 59, endOffset: 73,
        range: { start: { line: 3, character: 27 }, end: { line: 3, character: 41 } },
      },
      {
        kind: "identifier", text: "interface", sourceUri: "file:///workspace/main.slang",
        startOffset: 74, endOffset: 83,
        range: { start: { line: 4, character: 0 }, end: { line: 4, character: 9 } },
      },
      {
        kind: "identifier", text: "extension", sourceUri: "file:///workspace/main.slang",
        startOffset: 90, endOffset: 99,
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 9 } },
      },
      {
        kind: "string", text: "\"a\\\"b\"", sourceUri: "file:///workspace/main.slang",
        startOffset: 125, endOffset: 131,
        range: { start: { line: 6, character: 10 }, end: { line: 6, character: 16 } },
      },
      {
        kind: "punctuation", text: ">", sourceUri: "file:///workspace/main.slang",
        startOffset: 144, endOffset: 145,
        range: { start: { line: 7, character: 11 }, end: { line: 7, character: 12 } },
      },
      {
        kind: "punctuation", text: ">", sourceUri: "file:///workspace/main.slang",
        startOffset: 145, endOffset: 146,
        range: { start: { line: 7, character: 12 }, end: { line: 7, character: 13 } },
      },
      {
        kind: "preprocessor", text: "#define SUM(a, b) a + \\\n  b\n", sourceUri: "file:///workspace/main.slang",
        startOffset: 150, endOffset: 178,
        range: { start: { line: 8, character: 0 }, end: { line: 10, character: 0 } },
      },
    ]));
    expect(document.tokens.map((token) => token.text).join("")).toBe(source);
    expect(document.diagnostics).toEqual([]);
  });

  // Mutation caught: accepting an unterminated atomic token hides unsupported input from later stages.
  it("reports an unterminated block comment without changing its bytes", () => {
    const document = tokenizeSlang("file:///workspace/broken.slang", "/* open\nfloat value = \"open");

    expect(document.tokens.map((token) => [token.kind, token.text, token.startOffset, token.endOffset]))
      .toEqual([
        ["comment", "/* open\nfloat value = \"open", 0, 27],
      ]);
    expect(document.diagnostics).toEqual([
      {
        code: "slang-debug-unsupported-syntax",
        message: "Unterminated block comment.",
        sourceUri: "file:///workspace/broken.slang",
        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 19 } },
      },
    ]);
  });

  // Mutation caught: treating an unterminated string as normal punctuation lets later parsing invent syntax.
  it("reports an unterminated string without splitting it", () => {
    const document = tokenizeSlang("file:///workspace/string.slang", "float value = \"open");

    expect(document.tokens.map((token) => [token.kind, token.text, token.startOffset, token.endOffset]))
      .toEqual([
        ["identifier", "float", 0, 5],
        ["whitespace", " ", 5, 6],
        ["identifier", "value", 6, 11],
        ["whitespace", " ", 11, 12],
        ["operator", "=", 12, 13],
        ["whitespace", " ", 13, 14],
        ["string", "\"open", 14, 19],
      ]);
    expect(document.diagnostics).toEqual([
      {
        code: "slang-debug-unsupported-syntax",
        message: "Unterminated string literal.",
        sourceUri: "file:///workspace/string.slang",
        range: { start: { line: 0, character: 14 }, end: { line: 0, character: 19 } },
      },
    ]);
  });

  // Mutation caught: clearing line-start state for indentation breaks otherwise valid preprocessor directives.
  it("keeps an indented directive atomic", () => {
    const document = tokenizeSlang("file:///workspace/indented.slang", "  #if 0\nfloat inactive;\n#endif\n");

    expect(document.tokens.map((token) => [token.kind, token.text, token.startOffset, token.endOffset]))
      .toEqual([
        ["whitespace", "  ", 0, 2],
        ["preprocessor", "#if 0\n", 2, 8],
        ["identifier", "float", 8, 13],
        ["whitespace", " ", 13, 14],
        ["identifier", "inactive", 14, 22],
        ["punctuation", ";", 22, 23],
        ["whitespace", "\n", 23, 24],
        ["preprocessor", "#endif\n", 24, 31],
      ]);
  });
});
