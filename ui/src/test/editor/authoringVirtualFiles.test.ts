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
  const common = { path: "/shader/common.glsl", text: "#define PI 3.14159\n", version: 3 };
  const toUri = (path: string) => `file://${path}`;

  it("hands the common file to the pass being edited", () => {
    expect(commonAuthoringFile(common, "Warp", toUri)).toEqual({
      uri: "file:///shader/common.glsl",
      text: "#define PI 3.14159\n",
      version: 3,
    });
  });

  it("withholds it from the common pass itself, which would then define its own symbols twice", () => {
    expect(commonAuthoringFile(common, "common", toUri)).toBeUndefined();
    expect(commonAuthoringFile(common, "Common", toUri)).toBeUndefined();
    expect(commonAuthoringFile(common, " common ", toUri)).toBeUndefined();
  });

  it("has nothing to hand over when the shader declares no common pass", () => {
    expect(commonAuthoringFile(null, "Image", toUri)).toBeUndefined();
  });
});
