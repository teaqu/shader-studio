/// <reference types="@webgpu/types" />
import type { BlendMode } from "@shader-studio/types";

/** ColorTargetState.blend per blend mode, matching the WebGL factors; none omits blending. */
export function webgpuBlendState(blend: BlendMode): { blend?: GPUBlendState } {
  switch (blend) {
    case "none":
      return {};
    case "alpha":
      return {
        blend: {
          color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        },
      };
    case "premultiplied":
      return {
        blend: {
          color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
        },
      };
    case "additive":
      return {
        blend: {
          color: { operation: "add", srcFactor: "one", dstFactor: "one" },
          alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
        },
      };
  }
}
