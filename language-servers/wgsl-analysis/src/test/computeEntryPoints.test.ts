import { describe, expect, it } from "vitest";
import { getWgslComputeEntryPoints } from "../computeEntryPoints";

describe("getWgslComputeEntryPoints", () => {
  it("returns entries in source order with literal decimal workgroup dimensions", () => {
    expect(getWgslComputeEntryPoints([
      "@compute @workgroup_size(8, 4, 2) fn first() {}",
      "@workgroup_size(16) @compute fn second() {}",
      "@compute fn third() {}",
    ].join("\n"))).toEqual([
      { name: "first", workgroupSize: [8, 4, 2] },
      { name: "second", workgroupSize: [16, 1, 1] },
      { name: "third", workgroupSize: [1, 1, 1] },
    ]);
  });

  it("recognizes either attribute order across comments while ignoring commented entries", () => {
    expect(getWgslComputeEntryPoints([
      "// @compute @workgroup_size(64) fn hidden() {}",
      "@workgroup_size(2, 3) /* between attributes */ @compute",
      "fn visible() {}",
      "/* outer /* @compute fn nestedHidden() {} */ still hidden */",
    ].join("\n"))).toEqual([
      { name: "visible", workgroupSize: [2, 3, 1] },
    ]);
  });

  it("rejects non-positive, suffixed, and non-literal workgroup dimensions", () => {
    expect(getWgslComputeEntryPoints([
      "@compute @workgroup_size(0) fn zero() {}",
      "@compute @workgroup_size(8u) fn suffixed() {}",
      "@compute @workgroup_size(WORKGROUP) fn named() {}",
    ].join("\n"))).toEqual([]);
  });
});
