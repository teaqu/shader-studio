import { describe, expect, it } from "vitest";
import { splitSlangRootHeader, SUPPORTED_SLANG_LANGUAGE_VERSIONS } from "../../webgpu/SlangLanguageHeader";

const bomCount = (source: string) => [...source].filter((character) => character === "\uFEFF").length;

describe("SlangLanguageHeader", () => {
  it("lists exactly the supported language versions", () => {
    expect(SUPPORTED_SLANG_LANGUAGE_VERSIONS).toEqual(["legacy", "2025", "2026", "latest"]);
  });
  it.each(["\n", "\r", "\r\n"])("injects legacy using %j and preserves exactly one BOM", (newline) => {
    const result = splitSlangRootHeader(`\uFEFFfloat x;${newline}`);
    expect(result).toMatchObject({ header: `\uFEFF#language slang legacy${newline}`, body: `float x;${newline}`, language: "legacy" });
    expect(bomCount(result.header + result.body)).toBe(1);
  });
  it.each(["legacy", "2025", "2026", "latest"] as const)("extracts only %s directive/module while retaining leading trivia in the body", (language) => {
    const source = `// comment\n#language slang ${language}\nmodule test.name;\nfloat x;`;
    expect(splitSlangRootHeader(source)).toMatchObject({ header: `#language slang ${language}\nmodule test.name;\n`, body: `// comment\n\n\nfloat x;`, language });
  });
  it.each(["\n", "\r", "\r\n"])("preserves %j placeholders for explicit directive and module extraction", (newline) => {
    const source = `#language slang 2026${newline}module test.name;${newline}float x;`;
    const result = splitSlangRootHeader(source);
    expect(result.header).toBe(`#language slang 2026${newline}module test.name;${newline}`);
    expect(result.body).toBe(`${newline}${newline}float x;`);
    expect(result.body.split(/\r\n|\n|\r/)).toHaveLength(source.split(/\r\n|\n|\r/).length);
  });
  it("recognizes directives after whitespace and comments without extracting them", () => {
    const result = splitSlangRootHeader(" \t// one\n/* two */\n#language slang 2026\nfloat x;");
    expect(result).toMatchObject({ header: "#language slang 2026\n", body: " \t// one\n/* two */\n\nfloat x;", language: "2026" });
  });
  it("extracts a module following arbitrary trivia but not a later module after real source", () => {
    const result = splitSlangRootHeader("#language slang 2026\n// comment\n/* block */\nmodule dotted.name;\nfloat x;\nmodule later;");
    expect(result).toMatchObject({ header: "#language slang 2026\nmodule dotted.name;\n", body: "\n// comment\n/* block */\n\nfloat x;\nmodule later;" });
  });
  it("preserves exactly one BOM for explicit headers", () => {
    const result = splitSlangRootHeader("\uFEFF#language slang 2026\nfloat x;");
    expect(result).toMatchObject({ header: "\uFEFF#language slang 2026\n", body: "\nfloat x;" });
    expect(bomCount(result.header + result.body)).toBe(1);
  });
  it("keeps unsupported directives, their language, and their zero-based diagnostic", () => {
    const result = splitSlangRootHeader("// x\n#language slang 2030\nfloat x;");
    expect(result).toMatchObject({ language: "2030", body: "// x\n\nfloat x;", diagnostics: [{ line: 1, message: "Unsupported Slang language version \"2030\"; expected legacy, 2025, 2026, or latest" }] });
    expect(result.header).toBe("#language slang 2030\n");
  });
  it("does not extract a directive after real source", () => {
    expect(splitSlangRootHeader("float x;\n#language slang 2026\n")).toMatchObject({ header: "#language slang legacy\n", body: "float x;\n#language slang 2026\n", language: "legacy" });
  });
  it("treats unterminated leading block comments as source", () => {
    expect(splitSlangRootHeader("/* never closes\n#language slang 2026")).toMatchObject({ header: "#language slang legacy\n", body: "/* never closes\n#language slang 2026" });
  });
});
