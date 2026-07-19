import { describe, expect, it } from "vitest";
import {
  SUPPORTED_SLANG_LANGUAGE_VERSIONS,
  splitSlangRootHeader,
} from "../languageHeader";

describe("splitSlangRootHeader", () => {
  it("injects an explicit legacy policy when the root has no directive", () => {
    const source = "float4 mainImage(float2 p) { return 0; }\n";

    expect(splitSlangRootHeader(source)).toEqual({
      header: "#language slang legacy\n",
      body: source,
      language: "legacy",
      diagnostics: [],
    });
  });

  it.each(SUPPORTED_SLANG_LANGUAGE_VERSIONS)("preserves explicit %s before generated code", (version) => {
    const source = `// leading comment\n#language slang ${version}\nmodule image;\nfloat4 mainImage(float2 p) { return 0; }\n`;
    const result = splitSlangRootHeader(source);

    expect(result.header).toBe(`#language slang ${version}\nmodule image;\n`);
    expect(result.body.split("\n").slice(0, 3)).toEqual(["// leading comment", "", ""]);
    expect(result.body).toContain("float4 mainImage");
    expect(result.language).toBe(version);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves CRLF line endings and source line placeholders", () => {
    const result = splitSlangRootHeader("#language slang 2026\r\nmodule image;\r\nfloat x;\r\n");

    expect(result.header).toBe("#language slang 2026\r\nmodule image;\r\n");
    expect(result.body).toBe("\r\n\r\nfloat x;\r\n");
  });

  it("reports an unsupported explicit language without silently changing it", () => {
    const result = splitSlangRootHeader("#language slang 2030\nfloat x;\n");

    expect(result.header).toBe("#language slang 2030\n");
    expect(result.language).toBe("2030");
    expect(result.diagnostics).toEqual([{
      line: 0,
      message: "Unsupported Slang language version \"2030\"; expected legacy, 2025, 2026, or latest",
    }]);
  });

  it("does not extract a later directive after real source", () => {
    const source = "float x;\n#language slang 2026\n";
    const result = splitSlangRootHeader(source);

    expect(result.header).toBe("#language slang legacy\n");
    expect(result.body).toBe(source);
  });

  it("recognizes a directive after block comments and keeps those lines in the body", () => {
    const source = "/* heading\n * details\n */\n\n#language slang 2026\nmodule image;\nfloat x;\n";
    const result = splitSlangRootHeader(source);

    expect(result.header).toBe("#language slang 2026\nmodule image;\n");
    expect(result.body).toBe("/* heading\n * details\n */\n\n\n\nfloat x;\n");
  });

  it("reports the source line of an unsupported directive after leading comments", () => {
    const result = splitSlangRootHeader("// heading\n\n#language slang experimental\nfloat x;\n");

    expect(result.diagnostics[0]?.line).toBe(2);
    expect(result.header).toBe("#language slang experimental\n");
  });

  it("recognizes a directive after a line comment with CR newlines", () => {
    const result = splitSlangRootHeader("// heading\r#language slang 2025\rfloat x;\r");

    expect(result.header).toBe("#language slang 2025\r");
    expect(result.body).toBe("// heading\r\rfloat x;\r");
  });

  it("only extracts a module declaration immediately following the directive trivia", () => {
    const source = "#language slang 2026\nfloat x;\nmodule tooLate;\n";
    const result = splitSlangRootHeader(source);

    expect(result.header).toBe("#language slang 2026\n");
    expect(result.body).toBe("\nfloat x;\nmodule tooLate;\n");
  });
});
