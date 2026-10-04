import { describe, expect, it } from "vitest";
import { preserveLegacyMainImage } from "./LegacyMainImagePreservation";

describe("preserveLegacyMainImage", () => {
  it.each(["wgsl", "slang"] as const)("renames a co-located %s hook", (language) => {
    const source = language === "wgsl" ? "fn mainImage(p: vec2f) -> vec4f { return vec4f(); }" : "float4 mainImage(float2 p) { return 1; }";
    expect(preserveLegacyMainImage(source, language, "_dbg")).toHaveLength(1);
  });
  it("does nothing without a legacy hook", () => {
    expect(preserveLegacyMainImage("@fragment fn image() -> @location(0) vec4f { return vec4f(); }", "wgsl", "_dbg")).toEqual([]);
  });
});
