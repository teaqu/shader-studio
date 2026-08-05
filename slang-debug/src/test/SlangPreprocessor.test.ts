import { describe, expect, it } from "vitest";
import { buildSlangPreprocessorModel } from "../SlangPreprocessor";
import { tokenizeSlang } from "../SlangTokenizer";

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

    expect(model.invocations).toEqual([
      {
        name: "DECL_FLOAT",
        invocationRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 17 } },
        argumentTokens: [expect.arrayContaining([
          expect.objectContaining({ text: "accum", startOffset: 47, endOffset: 52 }),
        ])],
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

    expect(model.invocations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "WRAPPED",
        invocationRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 14 } },
        writableOrigin: true,
      }),
      expect.objectContaining({
        name: "DECL_FLOAT",
        invocationRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 14 } },
        writableOrigin: false,
      }),
      expect.objectContaining({
        name: "LOOP",
        invocationRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 11 } },
        writableOrigin: true,
      }),
      expect.objectContaining({
        name: "LOOP",
        invocationRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 11 } },
        writableOrigin: false,
      }),
    ]));
  });

  // Mutation caught: treating a continued macro definition as a standalone line loses its replacement tokens.
  it("parses continuation lines as one macro definition", () => {
    const source = "#define JOIN(a, b) a + \\\n  b\nJOIN(left, right);\n";
    const model = buildSlangPreprocessorModel(tokenizeSlang("file:///workspace/continued.slang", source));

    expect(model.macros.get("JOIN")?.parameters).toEqual(["a", "b"]);
    expect(model.macros.get("JOIN")?.bodyTokens.map((token) => token.text).join(""))
      .toBe("a + \\\n  b\n");
    expect(model.invocations).toEqual([
      expect.objectContaining({
        name: "JOIN",
        invocationRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 17 } },
        writableOrigin: true,
      }),
    ]);
  });

  // Mutation caught: silently treating unsupported #if expressions as false conceals a non-Slang-complete branch decision.
  it("models #ifdef and #ifndef while diagnosing conditions outside the bounded subset", () => {
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
    expect(model.diagnostics).toEqual([
      {
        code: "slang-debug-unsupported-syntax",
        message: "Unsupported #if condition.",
        sourceUri: "file:///workspace/conditions.slang",
        range: { start: { line: 9, character: 0 }, end: { line: 10, character: 0 } },
      },
    ]);
  });
});
