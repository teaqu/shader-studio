import { describe, expect, it } from "vitest";
import { findMemberAccess, parseMemberExpression, swizzleSelections } from "../memberAccess";

describe("findMemberAccess", () => {
  it("reports the expression a member is being selected from", () => {
    const source = "void main() {\n  vec2 uv = coord;\n  uv.\n}";

    expect(findMemberAccess(source, { line: 2, character: 5 })).toEqual({ expression: "uv", prefix: "" });
  });

  it("reports the member characters already typed", () => {
    const source = "  uv.xy";

    expect(findMemberAccess(source, { line: 0, character: 7 })).toEqual({ expression: "uv", prefix: "xy" });
  });

  it("keeps chained member expressions intact", () => {
    const source = "  material.albedo.";

    expect(findMemberAccess(source, { line: 0, character: 18 })).toEqual({ expression: "material.albedo", prefix: "" });
  });

  it("includes call and index suffixes in the expression", () => {
    expect(findMemberAccess("  texture(sky, uv).", { line: 0, character: 19 }))
      .toEqual({ expression: "texture(sky, uv)", prefix: "" });
    expect(findMemberAccess("  points[index + 1].", { line: 0, character: 20 }))
      .toEqual({ expression: "points[index + 1]", prefix: "" });
    expect(findMemberAccess("  lights[0].color.", { line: 0, character: 18 }))
      .toEqual({ expression: "lights[0].color", prefix: "" });
    expect(findMemberAccess("  bitcast<vec2u>(uv).", { line: 0, character: 21 }))
      .toEqual({ expression: "bitcast<vec2u>(uv)", prefix: "" });
  });

  it("ignores positions that are not member selections", () => {
    expect(findMemberAccess("  uv", { line: 0, character: 4 })).toBeUndefined();
    expect(findMemberAccess("  uv.x", { line: 0, character: 2 })).toBeUndefined();
    expect(findMemberAccess("  uv.x", { line: 0, character: 99 })).toBeUndefined();
    expect(findMemberAccess("  uv.x", { line: 4, character: 0 })).toBeUndefined();
    expect(findMemberAccess("  uv.x", { line: 0, character: -1 })).toBeUndefined();
  });

  it("ignores float literals that end in a decimal point", () => {
    expect(findMemberAccess("  float t = 1.", { line: 0, character: 14 })).toBeUndefined();
    expect(findMemberAccess("  float t = 1.0", { line: 0, character: 15 })).toBeUndefined();
    expect(findMemberAccess("  float t = v0.", { line: 0, character: 15 }))
      .toEqual({ expression: "v0", prefix: "" });
  });

  it("ignores a dot with no expression in front of it", () => {
    expect(findMemberAccess("  .", { line: 0, character: 3 })).toBeUndefined();
    expect(findMemberAccess("  ).", { line: 0, character: 4 })).toBeUndefined();
  });

  it("tolerates whitespace around the selector", () => {
    expect(findMemberAccess("  uv . ", { line: 0, character: 7 })).toEqual({ expression: "uv", prefix: "" });
  });
});

describe("swizzleSelections", () => {
  it("offers only components, common prefixes, and useful rearrangements", () => {
    expect(swizzleSelections(2, ["xyzw", "rgba"])).toEqual([
      "x", "y", "xy", "r", "g", "rg", "yx", "gr",
    ]);
    expect(swizzleSelections(3, ["xyzw"])).toEqual(["x", "y", "z", "xy", "xyz", "yx", "zyx"]);
    expect(swizzleSelections(4, ["rgba"])).toEqual([
      "r", "g", "b", "a", "rg", "rgb", "rgba", "gr", "bgr", "bgra",
    ]);
    expect(swizzleSelections(4, ["stpq"])).toEqual([
      "s", "t", "p", "q", "st", "stp", "stpq", "ts", "pts",
    ]);
  });

  it.each([
    [2, 2, 8],
    [3, 2, 14],
    [4, 2, 19],
    [2, 3, 12],
    [3, 3, 21],
    [4, 3, 28],
  ])("keeps width %i with %i naming sets to %i suggestions", (size, setCount, count) => {
    const selections = swizzleSelections(size, ["xyzw", "rgba", "stpq"].slice(0, setCount));
    expect(selections).toHaveLength(count);
    expect(new Set(selections).size).toBe(count);
    expect(selections.some((selection) => ["xx", "xxxx", "yxzz", "xr", "qpts"].includes(selection))).toBe(false);
  });

  it("keeps common selections ahead of rearrangements across naming sets", () => {
    const selections = swizzleSelections(2, ["xyzw", "rgba"]);
    expect(selections.slice(0, 6)).toEqual(["x", "y", "xy", "r", "g", "rg"]);
    expect(swizzleSelections(2, ["xyzw", "rgba"])).toEqual(selections);
    expect(swizzleSelections(2, ["rgba", "xyzw"])).toEqual([
      "r", "g", "rg", "x", "y", "xy", "gr", "yx",
    ]);
    expect(swizzleSelections(2, [])).toEqual([]);
  });

  it("returns nothing for sizes outside the vector range", () => {
    expect(swizzleSelections(0, ["xyzw"])).toEqual([]);
    expect(swizzleSelections(1, ["xyzw"])).toEqual([]);
    expect(swizzleSelections(2.5, ["xyzw"])).toEqual([]);
    expect(swizzleSelections(5, ["xyzw"])).toEqual([]);
    expect(swizzleSelections(Number.NaN, ["xyzw"])).toEqual([]);
  });
});

describe("parseMemberExpression", () => {
  it("splits a selection chain into identifier, call, member, and index steps", () => {
    expect(parseMemberExpression("uv")).toEqual([{ kind: "identifier", name: "uv" }]);
    expect(parseMemberExpression("texture(sky, uv)")).toEqual([{ kind: "call", name: "texture" }]);
    expect(parseMemberExpression("lights[0].color")).toEqual([
      { kind: "identifier", name: "lights" },
      { kind: "index" },
      { kind: "member", name: "color" },
    ]);
    expect(parseMemberExpression("vec4(uv, 0.0, 1.0) . rgb")).toEqual([
      { kind: "call", name: "vec4" },
      { kind: "member", name: "rgb" },
    ]);
  });

  it("reports no steps for expressions that are not selection chains", () => {
    expect(parseMemberExpression("")).toEqual([]);
    expect(parseMemberExpression("(a + b)")).toEqual([]);
    expect(parseMemberExpression("uv + 1")).toEqual([]);
    expect(parseMemberExpression("uv.")).toEqual([]);
    expect(parseMemberExpression("texture(sky")).toEqual([]);
    expect(parseMemberExpression("lights[0")).toEqual([]);
  });
});
