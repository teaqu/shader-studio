import { describe, expect, it } from "vitest";

import {
  createShaderStudioAnalysisSource,
  isShaderStudioEntrySource,
} from "../shaderStudioContext";

const suffix = [
  "static float3 iResolution;",
  "static float4 iMouse;",
  "static float iTime;",
  "static float iTimeDelta;",
  "static float iFrameRate;",
  "static int iFrame;",
  "static float4 iChannelTime;",
  "static float4 iChannelLoaded;",
  "static float iSampleRate;",
  "static float4 iDate;",
  "static float3 iChannelResolution[4];",
  "static float3 iCameraPos;",
  "static float3 iCameraDir;",
].join("\n");

describe("Shader Studio language context", () => {
  it.each([
    "float4 mainImage(float2 p) { return 0; }",
    "float4\nmainImage\n( float2 p) { return 0; }",
    "float4\r\nmainImage\r\n( float2 p) { return 0; }",
    "/* prefix */ float4 /* gap */ mainImage /* gap */ (float2 p) { return 0; }",
  ])("recognizes an entry-point declaration across lexical whitespace: %j", (source) => {
    expect(isShaderStudioEntrySource(source)).toBe(true);
  });

  it.each([
    "// float4 mainImage(float2 p)",
    "/* float4 mainImage(float2 p) */",
    'let text = "float4 mainImage(\\\"escaped\\\")";',
    "let text = 'float4 mainImage(\\'escaped\\')';",
    "return mainImage(p);",
    "obj.mainImage(p);",
    "#define mainImage(x) (x)",
    "#define float4 mainImage(x)",
    "float4 notMainImage(float2 p);",
  ])("does not recognize non-declaration text: %j", (source) => {
    expect(isShaderStudioEntrySource(source)).toBe(false);
  });

  it.each([
    "#define DECLARE_ENTRY \\\nfloat4 mainImage(float2 p)",
    "DECLARE(float4 mainImage(float2 p))",
    "DECLARE({ float4 mainImage(float2 p); })",
    "DECLARE(; float4 mainImage(float2 p); )",
  ])("leaves declaration-shaped macro source byte-identical: %j", (source) => {
    expect(isShaderStudioEntrySource(source)).toBe(false);
    expect(createShaderStudioAnalysisSource(source)).toBe(source);
  });

  it.each([
    "public float4 mainImage(float2 p);",
    "static\nfloat4\nmainImage\n(float2 p);",
    "inline float4 mainImage(float2 p);",
    "extern float4 mainImage(float2 p);",
    "[Differentiable] public inline float4 mainImage(float2 p);",
  ])("accepts declaration modifiers at a declaration boundary: %j", (source) => {
    expect(isShaderStudioEntrySource(source)).toBe(true);
  });

  it.each([
    "namespace hidden { float4 mainImage(float2 p); }",
    "struct Hidden { float4 mainImage(float2 p); };",
    "interface IHidden { float4 mainImage(float2 p); }",
    "float4 helper() { float4 mainImage(float2 p); return 0.0; }",
    "#if 0\nfloat4 mainImage(float2 p);\n#endif",
    "#if FEATURE_FLAG\nfloat4 mainImage(float2 p);\n#endif",
    "#if FEATURE_FLAG\nfloat4 hidden(float2 p);\n#else\nfloat4 mainImage(float2 p);\n#endif",
    "#if 0\nfloat4 hidden(float2 p);\n#elif 0\nfloat4 mainImage(float2 p);\n#endif",
  ])("leaves non-global or inactive declarations byte-identical: %j", (source) => {
    expect(isShaderStudioEntrySource(source)).toBe(false);
    expect(createShaderStudioAnalysisSource(source)).toBe(source);
  });

  it.each([
    "#if 1\nfloat4 mainImage(float2 p);\n#endif",
    "#if 0\nfloat4 hidden(float2 p);\n#else\nfloat4 mainImage(float2 p);\n#endif",
    "#if 0\nfloat4 hidden(float2 p);\n#elif 1\nfloat4 mainImage(float2 p);\n#endif",
    "#if 1\n#if 0\nfloat4 hidden(float2 p);\n#else\nfloat4 mainImage(float2 p);\n#endif\n#endif",
  ])("recognizes declarations in known active conditional branches: %j", (source) => {
    expect(isShaderStudioEntrySource(source)).toBe(true);
  });

  it("handles EOF line comments without hiding preceding declarations", () => {
    expect(isShaderStudioEntrySource("float4 mainImage(float2 p); // trailing")).toBe(true);
    expect(isShaderStudioEntrySource("// float4 mainImage(float2 p)")).toBe(false);
  });

  it("keeps lexical offsets stable around non-BMP characters in strings and comments", () => {
    expect(isShaderStudioEntrySource('let label = "😀"; float4 mainImage(float2 p);')).toBe(true);
    expect(isShaderStudioEntrySource("/* 😀 */ float4 mainImage(float2 p);")).toBe(true);
  });

  it("appends the exact deterministic built-in suffix while preserving the original prefix", () => {
    const source = "float4 mainImage(float2 p) { return 0; }";
    const analysisSource = createShaderStudioAnalysisSource(source);

    expect(analysisSource).toBe(`${source}\n\n${suffix}`);
    expect(analysisSource.startsWith(source)).toBe(true);
  });

  it("adds a blank separator line when the source already ends with a newline", () => {
    const source = "float4 mainImage(float2 p) { return 0; }\n";

    expect(createShaderStudioAnalysisSource(source)).toBe(`${source}\n${suffix}`);
  });

  it.each([
    "float4 mainImage(float2 p) { return iResolution.x; } // trailing \\",
    "float4 mainImage(float2 p) { return iResolution.x; } // trailing \\\n",
  ])("protects the suffix from a trailing continued line comment: %j", (source) => {
    const expectedSeparator = source.endsWith("\n") ? "\n" : "\n\n";
    expect(createShaderStudioAnalysisSource(source)).toBe(`${source}${expectedSeparator}${suffix}`);
  });

  it("returns non-entry sources byte-for-byte unchanged", () => {
    const source = "module helper;\r\nfloat helper(float2 p) { return p.x; }\r\n";

    expect(createShaderStudioAnalysisSource(source)).toBe(source);
  });
});
