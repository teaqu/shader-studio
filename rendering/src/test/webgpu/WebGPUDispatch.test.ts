import { describe, expect, it } from "vitest";
import { resolveWorkgroupCounts } from "../../webgpu/WebGPUDispatch";
import type { RenderPassNode } from "../../webgpu/SlangPassGraph";

function texelPass(outputKind: "2d" | "cubemap", workgroupSize: [number, number, number]): RenderPassNode {
  return {
    name: "Sky", source: "", language: "slang", kind: "compute", geometry: "fullscreen", output: "texture",
    outputKind, outputLayers: outputKind === "cubemap" ? 6 : 1, width: 17, height: 9, workgroupSize,
    dispatch: { mode: "texel" }, dispatchCount: 1, dispatchOnce: false, channels: [], entryPoint: "draw",
  };
}

describe("resolveWorkgroupCounts", () => {
  it("covers all six cube layers for texel dispatches", () => {
    expect(resolveWorkgroupCounts(texelPass("cubemap", [8, 4, 2]), new Map(), [])).toEqual([3, 3, 3]);
  });

  it("keeps 2d texel dispatches on one z workgroup", () => {
    expect(resolveWorkgroupCounts(texelPass("2d", [8, 4, 2]), new Map(), [])).toEqual([3, 3, 1]);
  });
});
