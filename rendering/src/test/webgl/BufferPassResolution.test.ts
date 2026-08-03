import { describe, expect, it } from "vitest";
import type { ShaderConfig } from "@shader-studio/types";
import { buildBufferPassSizes } from "../../webgl/BufferPassResolution";

describe("buildBufferPassSizes", () => {
  it("does not allocate a render-buffer size for the vertex source pass", () => {
    const config: ShaderConfig = {
      version: "1.0",
      passes: {
        Image: {},
        BufferA: { path: "buffer-a.glsl", resolution: { scale: 0.5 } },
        vertex: { path: "vertex.glsl" },
      },
    };

    expect(buildBufferPassSizes(config, 800, 600)).toEqual({
      BufferA: { width: 400, height: 300 },
    });
  });
});
