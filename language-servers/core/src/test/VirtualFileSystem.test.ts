import { describe, expect, it } from "vitest";
import { VirtualFileSystem, canonicalizeShaderUri } from "../VirtualFileSystem";

describe("VirtualFileSystem", () => {
  it("prefers unsaved overlays and restores environment files on close", () => {
    const fs = new VirtualFileSystem();
    fs.replaceEnvironment([{ uri: "file:///workspace/shaders/math.glsl", text: "disk", version: 1 }]);
    fs.openOverlay({ uri: "file:///workspace/shaders/math.glsl", text: "overlay", version: 2 });
    expect(fs.read("file:///workspace/shaders/math.glsl")?.text).toBe("overlay");
    fs.closeOverlay("file:///workspace/shaders/math.glsl");
    expect(fs.read("file:///workspace/shaders/math.glsl")?.text).toBe("disk");
  });

  it("resolves siblings but rejects traversal outside the workspace root", () => {
    const fs = new VirtualFileSystem();
    expect(fs.resolve("file:///workspace/shaders/image.glsl", "./common.glsl"))
      .toBe("file:///workspace/shaders/common.glsl");
    expect(fs.resolve("file:///workspace/shaders/image.glsl", "../../secret.glsl")).toBeUndefined();
  });

  it("tracks canonical dependency identities", () => {
    const fs = new VirtualFileSystem();
    fs.trackDependency("file:///workspace/a/../image.glsl", "file:///workspace/common.glsl");
    expect(fs.dependentsOf("file:///workspace/common.glsl")).toEqual(["file:///workspace/image.glsl"]);
    expect(canonicalizeShaderUri("file:///workspace/a/../image.glsl#x")).toBe("file:///workspace/image.glsl");
  });
});
