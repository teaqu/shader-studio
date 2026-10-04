// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sharedSourcePassNames } from "../../lib/editor/sharedSourcePassNames";

describe("shared source editor context", () => {
  it("includes Image, buffers and compute sharing a source while excluding Common and other sources", () => {
    expect(sharedSourcePassNames("/project/shared.wgsl", "/project/shared.wgsl", {
      Image: "/project/shared.wgsl", BufferA: "/project/shared.wgsl", Simulate: "/project/shared.wgsl",
      common: "/project/shared.wgsl", BufferB: "/project/b.wgsl",
    })).toEqual(["Image", "BufferA", "Simulate"]);
  });
  it("handles Windows path separators and missing root paths", () => {
    expect(sharedSourcePassNames("C:\\project\\shared.slang", "C:/project/shared.slang", { Simulate: "C:/project/shared.slang" })).toEqual(["Image", "Simulate"]);
    expect(sharedSourcePassNames("", "", {})).toEqual([]);
    expect(sharedSourcePassNames("/other.wgsl", "/image.wgsl", {})).toEqual([]);
  });
});
