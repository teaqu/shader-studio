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
  it("lists single components and contiguous runs for each component set", () => {
    expect(swizzleSelections(2, ["xyzw", "rgba"])).toEqual([
      "x", "y", "xy",
      "r", "g", "rg",
    ]);
  });

  it("limits selections to the components the vector actually has", () => {
    expect(swizzleSelections(3, ["xyzw"])).toEqual(["x", "y", "z", "xy", "xyz"]);
    expect(swizzleSelections(4, ["stpq"])).toEqual(["s", "t", "p", "q", "st", "stp", "stpq"]);
  });

  it("returns nothing for sizes outside the vector range", () => {
    expect(swizzleSelections(1, ["xyzw"])).toEqual([]);
    expect(swizzleSelections(5, ["xyzw"])).toEqual([]);
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
