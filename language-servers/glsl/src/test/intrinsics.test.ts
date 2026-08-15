import { describe, expect, it } from "vitest";
import { GLSL_INTRINSICS, findGlslIntrinsics } from "../intrinsics";

describe("GLSL intrinsics", () => {
  it("contains WebGL overloads and stage filtering", () => {
    expect(findGlslIntrinsics("texture", 300, "fragment").some((item) => item.signature.includes("sampler2D"))).toBe(true);
    expect(findGlslIntrinsics("texture2D", 300, "fragment")).toEqual([]);
    expect(findGlslIntrinsics("texture2D", 100, "fragment")).toHaveLength(1);
    expect(findGlslIntrinsics("dFdx", 300, "vertex")).toEqual([]);
    expect(findGlslIntrinsics("dFdx", 300, "fragment")).toHaveLength(1);
  });

  it("uses concise descriptions without return-value boilerplate", () => {
    expect(GLSL_INTRINSICS.filter((item) => /^returns?\b/i.test(item.description))).toEqual([]);
  });
});
