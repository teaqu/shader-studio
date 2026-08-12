import { describe, expect, it } from "vitest";
import { slangAuthoringVirtualFiles } from "../../lib/editor/authoringVirtualFiles";

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
