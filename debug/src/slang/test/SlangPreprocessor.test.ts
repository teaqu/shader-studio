import { describe, expect, it } from "vitest";
import { buildSlangPreprocessorModel } from "../SlangPreprocessor";
import { tokenizeSlang } from "../SlangTokenizer";

function invocationSummaries(model: ReturnType<typeof buildSlangPreprocessorModel>) {
  return model.invocations.map((invocation) => ({
    name: invocation.name,
    invocationRange: invocation.invocationRange,
    argumentTexts: invocation.argumentTokens.map((argument) => argument.map((token) => token.text)),
    writableOrigin: invocation.writableOrigin,
  }));
}

describe("buildSlangPreprocessorModel", () => {
  // Mutation caught: interpreting #if branches as active leaks declarations that cannot exist at runtime.
  it("keeps literal and defined active branches while retaining exact inactive ranges", () => {
    const source = "#define DECL_FLOAT(name) float name\n"
      + "#if 0\n"
      + "float dead;\n"
      + "#else\n"
      + "DECL_FLOAT(accum);\n"
      + "#endif\n"
      + "#if defined(DECL_FLOAT)\n"
      + "float included;\n"
      + "#endif\n"
      + "#if 1\n"
      + "float one;\n"
      + "#else\n"
      + "float never;\n"
      + "#endif\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/macros.slang", source));

    expect(model.activeTokens.map((token) => token.text).join("")).toBe("DECL_FLOAT(accum);\nfloat included;\nfloat one;\n");
    expect(model.activeTokens.some((token) => token.text === "dead")).toBe(false);
    expect(model.activeTokens.some((token) => token.text === "never")).toBe(false);
    expect(model.inactiveRanges).toEqual([
      { start: { line: 2, character: 0 }, end: { line: 3, character: 0 } },
      { start: { line: 12, character: 0 }, end: { line: 13, character: 0 } },
    ]);
    expect(model.macros.get("DECL_FLOAT")).toMatchObject({
      name: "DECL_FLOAT",
      parameters: ["name"],
      definitionRange: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
    });
    expect(model.diagnostics).toEqual([]);
  });

  // Mutation caught: using a macro definition range as a writable source origin edits the wrong source bytes.
  it("uses the physical direct invocation as the only writable macro origin", () => {
    const source = "#define DECL_FLOAT(name) float name\nDECL_FLOAT(accum);\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/direct.slang", source));

    expect(invocationSummaries(model)).toEqual([
      {
        name: "DECL_FLOAT",
        invocationRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 17 } },
        argumentTexts: [["accum"]],
        writableOrigin: true,
      },
    ]);
    expect(model.macros.get("DECL_FLOAT")?.definitionRange)
      .toEqual({ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } });
  });

  // Mutation caught: treating macro output as a direct source invocation invents a writable nested origin.
  it("marks nested and recursive expansion-only macro calls non-writable", () => {
    const source = "#define DECL_FLOAT(name) float name\n"
      + "#define WRAPPED(name) DECL_FLOAT(name)\n"
      + "#define LOOP(name) LOOP(name)\n"
      + "WRAPPED(total);\n"
      + "LOOP(count);\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/nested.slang", source));

    expect(invocationSummaries(model)).toEqual([
      {
        name: "WRAPPED",
        invocationRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 14 } },
        argumentTexts: [["total"]],
        writableOrigin: true,
      },
      {
        name: "LOOP",
        invocationRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 11 } },
        argumentTexts: [["count"]],
        writableOrigin: true,
      },
      {
        name: "DECL_FLOAT",
        invocationRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 14 } },
        argumentTexts: [["name"]],
        writableOrigin: false,
      },
      {
        name: "LOOP",
        invocationRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 11 } },
        argumentTexts: [["name"]],
        writableOrigin: false,
      },
    ]);
  });

  // Mutation caught: treating a continued macro definition as a standalone line loses its replacement tokens.
  it("parses continuation lines as one macro definition", () => {
    const source = "#define JOIN(a, b) a + \\\n  b\nJOIN(left, right);\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/continued.slang", source));

    expect(model.macros.get("JOIN")?.parameters).toEqual(["a", "b"]);
    expect(model.macros.get("JOIN")?.bodyTokens.map((token) => token.text).join(""))
      .toBe("a + \\\n  b\n");
    expect(invocationSummaries(model)).toEqual([
      {
        name: "JOIN",
        invocationRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 17 } },
        argumentTexts: [["left"], [" ", "right"]],
        writableOrigin: true,
      },
    ]);
  });

  it("models #ifdef, #ifndef, and undefined identifiers in conditions", () => {
    const source = "#define ENABLED\n"
      + "#ifdef ENABLED\n"
      + "float enabled;\n"
      + "#endif\n"
      + "#ifndef ENABLED\n"
      + "float disabled;\n"
      + "#else\n"
      + "float fallback;\n"
      + "#endif\n"
      + "#if FEATURE_FLAG\n"
      + "float unsupported;\n"
      + "#endif\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/conditions.slang", source));

    expect(model.activeTokens.map((token) => token.text).join(""))
      .toBe("float enabled;\nfloat fallback;\n");
    expect(model.inactiveRanges).toEqual([
      { start: { line: 5, character: 0 }, end: { line: 6, character: 0 } },
      { start: { line: 10, character: 0 }, end: { line: 11, character: 0 } },
    ]);
    expect(model.diagnostics).toEqual([]);
  });

  it("selects exactly one #if/#elif/#else branch and accepts include directives", () => {
    const source = "#if 1\n"
      + "#if 0\n"
      + "float innerHidden;\n"
      + "#else\n"
      + "float innerVisible;\n"
      + "#endif\n"
      + "#elif 0\n"
      + "float stillActive;\n"
      + "#endif\n"
      + "#include \"other.slang\"\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/unsupported.slang", source));

    expect(model.activeTokens.map((token) => token.text).join(""))
      .toBe("float innerVisible;\n");
    expect(model.inactiveRanges).toEqual([
      { start: { line: 2, character: 0 }, end: { line: 3, character: 0 } },
      { start: { line: 7, character: 0 }, end: { line: 8, character: 0 } },
    ]);
    expect(model.diagnostics).toEqual([]);
  });

  it("evaluates integer macro expressions and removes macros with #undef", () => {
    const source = "#define LEVEL 2\n"
      + "#if defined(LEVEL) && LEVEL >= 2\n"
      + "float selected;\n"
      + "#elif LEVEL == 1\n"
      + "float fallback;\n"
      + "#endif\n"
      + "#undef LEVEL\n"
      + "#if !defined(LEVEL)\n"
      + "float removed;\n"
      + "#endif\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/expressions.slang", source));

    expect(model.activeTokens.map((token) => token.text).join(""))
      .toBe("float selected;\nfloat removed;\n");
    expect(model.macros.has("LEVEL")).toBe(false);
    expect(model.diagnostics).toEqual([]);
  });

  // Mutation caught: dropping unmatched opening frames at EOF loses the source range needed to explain unsupported scope.
  it("reports every unclosed conditional at its opening directive range", () => {
    const source = "#if 1\n#ifdef FLAG\nfloat hidden;\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/unclosed.slang", source));

    expect(model.activeTokens).toEqual([]);
    expect(model.diagnostics).toEqual([
      {
        code: "slang-debug-unsupported-syntax",
        message: "Unclosed #if directive.",
        sourceUri: "file:///workspace/unclosed.slang",
        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
      },
      {
        code: "slang-debug-unsupported-syntax",
        message: "Unclosed #ifdef directive.",
        sourceUri: "file:///workspace/unclosed.slang",
        range: { start: { line: 1, character: 0 }, end: { line: 2, character: 0 } },
      },
    ]);
  });

  // Mutation caught: treating a bare function-like macro name as an invocation invents a writable edit origin.
  it("distinguishes function-like macros and groups nested-call arguments", () => {
    const source = "#define DECL_FLOAT(name) float name\n"
      + "#define VALUE 1\n"
      + "DECL_FLOAT;\n"
      + "DECL_FLOAT(f(x, y), g);\n"
      + "VALUE;\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/function-like.slang", source));

    expect([...model.macros.values()].map((macro) => ({
      name: macro.name,
      functionLike: macro.functionLike,
      parameters: macro.parameters,
    }))).toEqual([
      { name: "DECL_FLOAT", functionLike: true, parameters: ["name"] },
      { name: "VALUE", functionLike: false, parameters: [] },
    ]);
    expect(invocationSummaries(model)).toEqual([
      {
        name: "DECL_FLOAT",
        invocationRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 22 } },
        argumentTexts: [["f", "(", "x", ",", " ", "y", ")"], [" ", "g"]],
        writableOrigin: true,
      },
      {
        name: "VALUE",
        invocationRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 5 } },
        argumentTexts: [],
        writableOrigin: true,
      },
    ]);
  });

  // Mutation caught: dropping a CRLF continuation separates one physical directive into two fake lines.
  it("preserves CRLF continued directive bytes and physical invocation ranges", () => {
    const source = "#define JOIN(a, b) a + \\\r\n  b\r\nJOIN(f(x, y), g);\r\n";
    const document = tokenizeSlang("file:///workspace/crlf.slang", source);
    const model = buildSlangPreprocessorModel(document);

    expect(document.tokens[0]).toMatchObject({
      kind: "preprocessor",
      text: "#define JOIN(a, b) a + \\\r\n  b\r\n",
      startOffset: 0,
      endOffset: 31,
      range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
    });
    expect(model.macros.get("JOIN")?.definitionRange)
      .toEqual({ start: { line: 0, character: 0 }, end: { line: 2, character: 0 } });
    expect(invocationSummaries(model)).toEqual([
      {
        name: "JOIN",
        invocationRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 16 } },
        argumentTexts: [["f", "(", "x", ",", " ", "y", ")"], [" ", "g"]],
        writableOrigin: true,
      },
    ]);
  });

  // Mutation caught: handling only LF/CRLF continuations makes a lone-CR directive condition unsupported.
  it("evaluates lone-CR continued directives as one physical condition", () => {
    const source = "#if \\\r1\rfloat live;\r#endif\r";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/lone-cr.slang", source));

    expect(model.activeTokens.map((token) => token.text).join("")).toBe("float live;\r");
    expect(model.diagnostics).toEqual([]);
  });
});
