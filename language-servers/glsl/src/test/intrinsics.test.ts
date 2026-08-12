import { describe, expect, it } from "vitest";
import { findGlslIntrinsics } from "../intrinsics";

describe("GLSL intrinsics", () => {
  it("contains WebGL overloads and stage filtering", () => {
    expect(findGlslIntrinsics("texture", 300, "fragment").some((item) => item.signature.includes("sampler2D"))).toBe(true);
    expect(findGlslIntrinsics("dFdx", 300, "vertex")).toEqual([]);
    expect(findGlslIntrinsics("dFdx", 300, "fragment")).toHaveLength(1);
  });
});
