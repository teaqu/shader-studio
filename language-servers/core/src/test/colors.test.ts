import { describe, expect, it } from "vitest";
import { createLiteralColorPresentations, findLiteralConstructorColors } from "../colors";

describe("literal shader colors", () => {
  it("finds literal RGB/RGBA constructors and ignores expressions", () => {
    const colors = findLiteralConstructorColors("vec3(1., .25, 0.0); vec4(base, 0., 0., 1.);", ["vec3", "vec4"]);
    expect(colors).toHaveLength(1);
    expect(colors[0]?.color).toEqual({ red: 1, green: 0.25, blue: 0, alpha: 1 });
  });

  it("rejects nested, malformed, and out-of-range constructors", () => {
    expect(findLiteralConstructorColors("vec3(abs(1.), 0., 0.); vec3(2., 0., 0.); vec2(1., 0.);", ["vec2", "vec3"])).toEqual([]);
  });

  it("creates language-specific color replacements", () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 10 } };
    expect(createLiteralColorPresentations("glsl", { red: 1, green: 0.5, blue: 0, alpha: 0.25 }, range)[0]?.textEdit)
      .toEqual({ range, newText: "vec4(1.0, 0.5, 0.0, 0.25)" });
    expect(createLiteralColorPresentations("slang", { red: 0, green: 0, blue: 0, alpha: 1 }, range)[0]?.label)
      .toBe("float4(0.0, 0.0, 0.0, 1.0)");
  });

  it("keeps the component count of the constructor being edited", () => {
    const glslSource = "vec3 a = vec3(1.0, 0.0, 0.0);\nvec4 b = vec4(1.0, 0.0, 0.0, 1.0);";
    const vec3Range = { start: { line: 0, character: 9 }, end: { line: 0, character: 28 } };
    const vec4Range = { start: { line: 1, character: 9 }, end: { line: 1, character: 33 } };
    expect(createLiteralColorPresentations("glsl", { red: 0, green: 0.5, blue: 1, alpha: 1 }, vec3Range, glslSource)[0])
      .toEqual({ label: "vec3(0.0, 0.5, 1.0)", textEdit: { range: vec3Range, newText: "vec3(0.0, 0.5, 1.0)" } });
    expect(createLiteralColorPresentations("glsl", { red: 0, green: 0.5, blue: 1, alpha: 0.5 }, vec4Range, glslSource)[0]?.label)
      .toBe("vec4(0.0, 0.5, 1.0, 0.5)");

    const slangSource = "float3 a = float3(1.0, 0.0, 0.0);\nfloat4 b = float4(1.0, 0.0, 0.0, 1.0);";
    const float3Range = { start: { line: 0, character: 11 }, end: { line: 0, character: 32 } };
    const float4Range = { start: { line: 1, character: 11 }, end: { line: 1, character: 37 } };
    expect(createLiteralColorPresentations("slang", { red: 0, green: 0.5, blue: 1, alpha: 1 }, float3Range, slangSource)[0]?.label)
      .toBe("float3(0.0, 0.5, 1.0)");
    expect(createLiteralColorPresentations("slang", { red: 0, green: 0.5, blue: 1, alpha: 0.5 }, float4Range, slangSource)[0]?.label)
      .toBe("float4(0.0, 0.5, 1.0, 0.5)");
  });

  it("falls back to the four-component constructor when the range does not name one", () => {
    const source = "vec3 a = vec3(1.0, 0.0, 0.0);";
    const outOfRange = { start: { line: 4, character: 0 }, end: { line: 4, character: 5 } };
    const notAConstructor = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } };
    expect(createLiteralColorPresentations("glsl", { red: 1, green: 1, blue: 1, alpha: 1 }, outOfRange, source)[0]?.label)
      .toBe("vec4(1.0, 1.0, 1.0, 1.0)");
    expect(createLiteralColorPresentations("glsl", { red: 1, green: 1, blue: 1, alpha: 1 }, notAConstructor, source)[0]?.label)
      .toBe("vec4(1.0, 1.0, 1.0, 1.0)");
  });
});
