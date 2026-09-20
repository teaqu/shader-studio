import { describe, expect, it } from "vitest";
import {
  findMemberAccess,
  isMemberSelection,
  memberSelectionAt,
  parseMemberExpression,
  swizzleCompletions,
  swizzleSelections,
} from "../memberAccess";

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
  it("offers components, contiguous runs, and useful rearrangements", () => {
    expect(swizzleSelections(2, ["xyzw", "rgba"])).toEqual([
      "x", "y", "xy", "r", "g", "rg", "yx", "gr",
    ]);
    expect(swizzleSelections(3, ["xyzw"])).toEqual(["x", "y", "z", "xy", "xyz", "yz", "yx", "zyx"]);
    expect(swizzleSelections(4, ["rgba"])).toEqual([
      "r", "g", "b", "a", "rg", "rgb", "rgba", "gb", "gba", "ba", "gr", "bgr", "bgra",
    ]);
    expect(swizzleSelections(4, ["stpq"])).toEqual([
      "s", "t", "p", "q", "st", "stp", "stpq", "tp", "tpq", "pq", "ts", "pts",
    ]);
  });

  it("offers runs that do not start at the first component", () => {
    // `iMouse.zw` and `rect.zw` are as common as `.xy`; a prefix-only list missed them.
    expect(swizzleSelections(4, ["xyzw"])).toEqual(expect.arrayContaining(["yz", "zw", "yzw"]));
    expect(swizzleSelections(3, ["rgba"])).toEqual(expect.arrayContaining(["gb"]));
    expect(swizzleSelections(3, ["rgba"])).not.toContain("ba");
  });

  it.each([
    [2, 2, 8],
    [3, 2, 16],
    [4, 2, 25],
    [2, 3, 12],
    [3, 3, 24],
    [4, 3, 37],
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

describe("swizzleCompletions", () => {
  it("adds the selection being typed when the curated list leaves it out", () => {
    const completions = swizzleCompletions(3, ["xyzw", "rgba"], "xyx");

    // First, so the exact match is what Enter accepts.
    expect(completions[0]).toBe("xyx");
    expect(completions.slice(1)).toEqual(swizzleSelections(3, ["xyzw", "rgba"]));
  });

  it("never duplicates a curated selection", () => {
    for (const typed of ["xy", "zw", "x", "bgra"]) {
      const completions = swizzleCompletions(4, ["xyzw", "rgba"], typed);
      expect(completions).toEqual(swizzleSelections(4, ["xyzw", "rgba"]));
      expect(completions.filter((selection) => selection === typed)).toHaveLength(1);
    }
  });

  it("refuses selections the vector cannot make", () => {
    const curated = swizzleSelections(2, ["xyzw", "rgba"]);
    // Out of range for a vec2, mixed naming sets, too long, and not a swizzle at all.
    for (const typed of ["xz", "xr", "xyxyx", "", "size", "Sample"]) {
      expect(swizzleCompletions(2, ["xyzw", "rgba"], typed), typed).toEqual(curated);
    }
  });

  it("accepts repeats and permutations the curated list omits", () => {
    expect(swizzleCompletions(4, ["xyzw"], "xxxx")[0]).toBe("xxxx");
    expect(swizzleCompletions(4, ["xyzw"], "wzyx")[0]).toBe("wzyx");
    expect(swizzleCompletions(4, ["rgba"], "grrr")[0]).toBe("grrr");
  });
});

describe("memberSelectionAt", () => {
  it("reads the whole identifier around the cursor", () => {
    // Completion invoked right after the dot still sees the selection being edited.
    expect(memberSelectionAt("uv.xyx", { line: 0, character: 3 })).toBe("xyx");
    expect(memberSelectionAt("uv.xyx", { line: 0, character: 5 })).toBe("xyx");
    expect(memberSelectionAt("uv.xyx", { line: 0, character: 6 })).toBe("xyx");
    expect(memberSelectionAt("a;\nuv.zw + 1.0", { line: 1, character: 4 })).toBe("zw");
  });

  it("reports nothing outside a line or an identifier", () => {
    expect(memberSelectionAt("uv.", { line: 0, character: 3 })).toBe("");
    expect(memberSelectionAt("uv.xy", { line: 4, character: 0 })).toBe("");
    expect(memberSelectionAt("uv.xy", { line: 0, character: 99 })).toBe("");
    expect(memberSelectionAt("uv.xy", { line: 0, character: -1 })).toBe("");
  });
});

describe("isMemberSelection", () => {
  it("separates member selections from plain identifiers", () => {
    expect(isMemberSelection("  uv.xy", 5)).toBe(true);
    expect(isMemberSelection("  uv.", 5)).toBe(true);
    expect(isMemberSelection("  uv", 4)).toBe(false);
    expect(isMemberSelection("  1.5", 5)).toBe(false);
    expect(isMemberSelection("", 0)).toBe(false);
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
