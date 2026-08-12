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
});
