import { describe, expect, it } from "vitest";
import { resolveBufferPassSize } from "../../webgl/BufferPassResolution";

describe("cubemap face resolution", () => {
  it("uses one fixed square face size independently of the viewport", () => {
    expect(resolveBufferPassSize({ outputKind: "cubemap" }, 800, 600)).toEqual({ width: 512, height: 512 });
    expect(resolveBufferPassSize({ outputKind: "cubemap", faceSize: 64 }, 800, 600)).toEqual({ width: 64, height: 64 });
  });
  it("respects cube texture and viewport limits without making nonsquare faces", () => {
    expect(resolveBufferPassSize({ outputKind: "cubemap", faceSize: 512 }, 800, 600, { maxWidth: 256, maxHeight: 128, maxCubeSize: 64 })).toEqual({ width: 64, height: 64 });
  });
});
