import { describe, expect, it } from "vitest";
import { webgpuBlendState } from "../../webgpu/WebGPURenderState";

describe("webgpuBlendState", () => {
  it("omits blending for none", () => {
    expect(webgpuBlendState("none")).toEqual({});
  });

  it.each([
    ["alpha", ["src-alpha", "one-minus-src-alpha"], ["one", "one-minus-src-alpha"]],
    ["premultiplied", ["one", "one-minus-src-alpha"], ["one", "one-minus-src-alpha"]],
    ["additive", ["one", "one"], ["one", "one"]],
  ] as const)("maps %s to the same add factors as WebGL", (blend, [colorSrc, colorDst], [alphaSrc, alphaDst]) => {
    expect(webgpuBlendState(blend)).toEqual({
      blend: {
        color: { operation: "add", srcFactor: colorSrc, dstFactor: colorDst },
        alpha: { operation: "add", srcFactor: alphaSrc, dstFactor: alphaDst },
      },
    });
  });
});
