import { describe, expect, it } from "vitest";
import { isShaderLanguageReservedTerm, isWgslReservedWord } from "./ShaderLanguageReservedTerms";

describe("isWgslReservedWord", () => {
  it.each(["shared", "enum", "class", "static", "loop", "fn", "var"])("rejects the WGSL keyword or reserved word %s", (name) => {
    expect(isWgslReservedWord(name)).toBe(true);
  });

  it.each(["mainImage", "writeOutput", "vec3f", "f32", "iTime", "iChannel0Sample", "sampleCube", "length", "shade"])(
    "accepts %s, which WGSL lets a declaration use or shadow",
    (name) => {
      expect(isWgslReservedWord(name)).toBe(false);
    },
  );

  it("stays narrower than the generated-name collision set", () => {
    expect(isShaderLanguageReservedTerm("wgsl", "mainImage")).toBe(true);
    expect(isWgslReservedWord("mainImage")).toBe(false);
  });
});
