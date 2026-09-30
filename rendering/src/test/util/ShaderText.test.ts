import { describe, expect, it } from "vitest";
import { stripComments, stripLineComment } from "../../util/ShaderText";

describe("shader text scanners", () => {
  it("handles repeated unterminated block-comment prefixes in linear time", () => {
    const source = `float x; /*${"a/*".repeat(100_000)}`;
    expect(stripComments(source)).toBe(source);
  });

  it("strips a line comment without scanning from every slash", () => {
    expect(stripLineComment(`${"/".repeat(200_000)}// hidden`)).toBe("");
  });
});
