import { describe, expect, it } from "vitest";
import type { BufferPass, ShaderConfig } from "@shader-studio/types";
import { buildSlangPassGraph } from "../../webgpu/SlangPassGraph";

const imageCode = "float4 mainImage(float2 fragCoord) { return float4(0, 0, 0, 1); }";

describe("buildSlangPassGraph", () => {
  it("creates an Image pass when no config is provided", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: null,
      buffers: {},
      canvasWidth: 800,
      canvasHeight: 600,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.warnings).toEqual([]);
    expect(graph.commonCode).toBe("");
    expect(graph.passes.map((pass) => pass.name)).toEqual(["Image"]);
    expect(graph.passes[0]).toMatchObject({
      name: "Image",
      source: imageCode,
      output: "canvas",
      width: 800,
      height: 600,
      channels: [],
    });
  });

  it("creates BufferA before Image and attaches common code to renderable passes", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: "buffer", source: "BufferA" },
          },
        },
        BufferA: {
          path: "buffer-a.slang",
          inputs: {},
          resolution: { scale: 0.5 },
        },
        common: {
          path: "common.slang",
          inputs: {},
        },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: {
        BufferA: "float4 mainImage(float2 fragCoord) { return float4(1, 0, 0, 1); }",
        common: "float sharedValue() { return 1.0; }",
      },
      canvasWidth: 640,
      canvasHeight: 360,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.commonCode).toBe("float sharedValue() { return 1.0; }");
    expect(graph.passes.map((pass) => pass.name)).toEqual(["BufferA", "Image"]);
    expect(graph.passes[0]).toMatchObject({
      name: "BufferA",
      output: "texture",
      width: 320,
      height: 180,
    });
    expect(graph.passes[1].channels).toEqual([
      { slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" },
    ]);
  });

  it("marks buffer pass inputs as previous-frame reads so self-feedback is valid", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferA" } } },
        BufferA: {
          path: "buffer-a.slang",
          inputs: { iChannel0: { type: "buffer", source: "BufferA" } },
        },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.find((pass) => pass.name === "BufferA")?.channels).toEqual([
      { slot: 0, key: "iChannel0", source: "BufferA", readFrom: "previous-frame" },
    ]);
  });

  it("reports unsupported inputs and missing buffer sources", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: "texture", path: "noise.png" },
            iChannel1: { type: "buffer", source: "MissingBuffer" },
          },
        },
        BufferA: { path: "buffer-a.slang", inputs: {} },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: {},
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toContain("BufferA: Buffer file not found or is empty (path: \"buffer-a.slang\")");
    expect(graph.errors).toContain("Image: iChannel1 references missing buffer \"MissingBuffer\"");
    expect(graph.warnings).toContain("Image: iChannel0 uses unsupported Slang/WebGPU input type \"texture\"");
  });

  it("uses fixed width/height resolution for buffer passes", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        BufferA: {
          path: "buffer-a.slang",
          inputs: {},
          resolution: { width: 256, height: 128 },
        },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode },
      canvasWidth: 800,
      canvasHeight: 600,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0]).toMatchObject({ name: "BufferA", width: 256, height: 128 });
  });

  it("applies scale on top of fixed width/height resolution", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {},
          resolution: { width: 200, height: 100, scale: 0.5 },
        },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: {},
      canvasWidth: 800,
      canvasHeight: 600,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0]).toMatchObject({ name: "Image", width: 100, height: 50 });
  });

  it("reports invalid resolution settings and falls back to canvas size", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        BufferA: {
          path: "buffer-a.slang",
          inputs: {},
          // Deliberately malformed: neither width/height nor scale.
          resolution: {} as BufferPass["resolution"],
        },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode },
      canvasWidth: 800,
      canvasHeight: 600,
    });

    expect(graph.errors).toEqual(["BufferA: Invalid resolution settings"]);
    expect(graph.passes[0]).toMatchObject({ name: "BufferA", width: 800, height: 600 });
  });

  it("warns and ignores inputs whose keys are not iChannelN", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            myTexture: { type: "buffer", source: "BufferA" },
          },
        },
        BufferA: { path: "buffer-a.slang", inputs: {} },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.warnings).toContain("Image: ignoring non-iChannel input \"myTexture\"");
    expect(graph.passes.find((pass) => pass.name === "Image")?.channels).toEqual([]);
  });

  it("warns and ignores iChannel slots above 15", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel16: { type: "buffer", source: "BufferA" },
          },
        },
        BufferA: { path: "buffer-a.slang", inputs: {} },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.warnings).toContain("Image: ignoring non-iChannel input \"iChannel16\"");
    expect(graph.passes.find((pass) => pass.name === "Image")?.channels).toEqual([]);
  });

  it("orders passes BufferA, BufferB, Image regardless of config key order", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        BufferB: { path: "buffer-b.slang", inputs: {} },
        BufferA: { path: "buffer-a.slang", inputs: {} },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode, BufferB: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.map((pass) => pass.name)).toEqual(["BufferA", "BufferB", "Image"]);
  });

  it("sorts channels by slot when inputs are declared out of order", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel1: { type: "buffer", source: "BufferB" },
            iChannel0: { type: "buffer", source: "BufferA" },
          },
        },
        BufferA: { path: "buffer-a.slang", inputs: {} },
        BufferB: { path: "buffer-b.slang", inputs: {} },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode, BufferB: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.find((pass) => pass.name === "Image")?.channels).toEqual([
      { slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" },
      { slot: 1, key: "iChannel1", source: "BufferB", readFrom: "current-frame" },
    ]);
  });

  it("populates path on successful buffer passes and leaves it undefined for Image", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        BufferA: { path: "buffer-a.slang", inputs: {} },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.find((pass) => pass.name === "BufferA")?.path).toBe("buffer-a.slang");
    expect(graph.passes.find((pass) => pass.name === "Image")?.path).toBeUndefined();
  });
});
