import { describe, expect, it } from "vitest";
import { commonAuthoringFile, slangAuthoringVirtualFiles } from "../../lib/editor/authoringVirtualFiles";

describe("slangAuthoringVirtualFiles", () => {
  it("exposes only the active pass modules and de-duplicates shared dependencies", () => {
    const files = slangAuthoringVirtualFiles([
      { moduleName: "palette", path: "/shader/lib/palette.slang", source: "module palette;", ownerPass: "Image" },
      { moduleName: "palette", path: "/shader/lib/palette.slang", source: "module palette;", ownerPass: "Image" },
      { moduleName: "noise", path: "/shader/lib/noise.slang", source: "module noise;", ownerPass: "Buffer A" },
    ], "Image", (path) => `file://${path}`);

    expect(files).toEqual([{
      uri: "file:///shader/lib/palette.slang",
      text: "module palette;",
      version: 1,
    }]);
  });
});

describe("commonAuthoringFile", () => {
  it("uses configured Common source for a render pass but does not inject it into its own editor", () => {
    const toUri = (path: string) => `file://${path}`;
    expect(commonAuthoringFile("Image", "/shader/common.wgsl", "fn shared() {}", toUri)).toEqual({
      uri: "file:///shader/common.wgsl", text: "fn shared() {}", version: 1,
    });
    expect(commonAuthoringFile("common", "/shader/common.wgsl", "stale", toUri)).toBeUndefined();
  });

  it("omits Common when its configured path or source is unavailable", () => {
    expect(commonAuthoringFile("Image", undefined, "shared", (path) => path)).toBeUndefined();
    expect(commonAuthoringFile("Image", "/shader/common.wgsl", undefined, (path) => path)).toBeUndefined();
  });
});
