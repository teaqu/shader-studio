import { describe, expect, it } from "vitest";
import { parseSlangRootHeader, SUPPORTED_SLANG_LANGUAGE_VERSIONS } from "../../webgpu/SlangLanguageHeader";

describe("SlangLanguageHeader", () => {
  it("lists exactly the supported language versions", () => {
    expect(SUPPORTED_SLANG_LANGUAGE_VERSIONS).toEqual(["legacy", "2025", "2026", "latest"]);
  });
  it("injects legacy using the source newline style without moving body lines", () => {
    expect(parseSlangRootHeader("float x;\r\n")).toMatchObject({ header: "#language slang legacy\r\n", body: "float x;\r\n", language: "legacy" });
  });
  it.each(["legacy", "2025", "2026", "latest"] as const)("preserves %s and its following module declaration", (language) => {
    const source = `// comment\n#language slang ${language}\nmodule test;\nfloat x;`;
    expect(parseSlangRootHeader(source)).toMatchObject({ header: `// comment\n#language slang ${language}\nmodule test;\n`, body: "\n\n\nfloat x;", language });
  });
  it("recognizes directives after whitespace and comments", () => {
    const result = parseSlangRootHeader(" \t// one\n/* two */\n#language slang 2026\nfloat x;");
    expect(result).toMatchObject({ language: "2026", body: "\n\n\nfloat x;" });
  });
  it.each(["\n", "\r", "\r\n"])("keeps line placeholders for extracted %j headers", (newline) => {
    const result = parseSlangRootHeader(`// x${newline}#language slang 2025${newline}float x;`);
    expect(result.body).toBe(`${newline}${newline}float x;`);
  });
  it("keeps one leading BOM for explicit and injected headers", () => {
    expect(parseSlangRootHeader("\uFEFF#language slang 2026\nfloat x;").header.startsWith("\uFEFF")).toBe(true);
    expect(parseSlangRootHeader("\uFEFFfloat x;").header).toBe("\uFEFF#language slang legacy\n");
  });
  it("keeps unsupported directives and diagnoses their source line", () => {
    const result = parseSlangRootHeader("// x\n#language slang 2030\nfloat x;");
    expect(result).toMatchObject({ language: "legacy", body: "\n\nfloat x;", diagnostics: [{ line: 2, message: "Unsupported Slang language version \"2030\"; expected one of: legacy, 2025, 2026, latest." }] });
    expect(result.header).toContain("#language slang 2030\n");
  });
  it("does not extract a directive after real source", () => {
    const result = parseSlangRootHeader("float x;\n#language slang 2026\n");
    expect(result).toMatchObject({ header: "#language slang legacy\n", body: "float x;\n#language slang 2026\n", language: "legacy" });
  });
  it("treats unterminated leading block comments as source", () => {
    const result = parseSlangRootHeader("/* never closes\n#language slang 2026");
    expect(result).toMatchObject({ header: "#language slang legacy\n", body: "/* never closes\n#language slang 2026" });
  });
});
