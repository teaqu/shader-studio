import { describe, expect, it } from "vitest";
import type { BufferPass, ShaderConfig } from "@shader-studio/types";
import {
  BUILTIN_STORAGE_TYPES,
  buildSlangPassGraph,
  isComputePassName,
} from "../../webgpu/SlangPassGraph";

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
      { kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" },
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
      { kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "previous-frame" },
    ]);
  });

  it("reports unsupported inputs and missing buffer sources", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: "audio", path: "noise.mp3" },
            iChannel1: { type: "buffer", source: "BufferB" },
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
    expect(graph.errors).toContain("Image: iChannel1 references missing buffer \"BufferB\"");
    expect(graph.warnings).toContain("Image: iChannel0 uses unsupported Slang/WebGPU input type \"audio\"");
  });

  it("errors when a channel's buffer source is Image, common, or missing", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            // "common" is a configured pass but not renderable, and "Image"
            // is renderable but not a buffer: neither can feed a channel.
            iChannel0: { type: "buffer", source: "common" },
            iChannel1: { type: "buffer", source: "Image" },
          },
        },
        BufferA: { path: "buffer-a.slang", inputs: {} },
        common: { path: "common.slang", inputs: {} },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode, common: "float shared() { return 1.0; }" },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toContain('Image: iChannel0 source "common" is not a buffer pass');
    expect(graph.errors).toContain('Image: iChannel1 source "Image" is not a buffer pass');
    expect(graph.passes.find((pass) => pass.name === "Image")?.channels).toEqual([]);
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

  it("applies scale on top of fixed width/height resolution for buffer passes", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        BufferA: {
          path: "buffer-a.slang",
          inputs: {},
          resolution: { width: 200, height: 100, scale: 0.5 },
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
    expect(graph.passes[0]).toMatchObject({ name: "BufferA", width: 100, height: 50 });
  });

  it("uses the canvas size for Image even when Image has resolution scale", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {},
          resolution: { scale: 0.5 },
        },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: {},
      canvasWidth: 400,
      canvasHeight: 225,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0]).toMatchObject({ name: "Image", width: 400, height: 225 });
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

  it("orders arbitrary render passes in config order before Image", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        BufferZ: { path: "buffer-z.slang", inputs: {} },
        Flow: {
          path: "flow.slang",
          inputs: { iChannel0: { type: "buffer", source: "BufferZ" } },
        },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferZ: imageCode, Flow: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.map((pass) => pass.name)).toEqual(["BufferZ", "Flow", "Image"]);
    expect(graph.passes[1].channels).toEqual([
      { kind: "buffer", slot: 0, key: "iChannel0", source: "BufferZ", readFrom: "current-frame" },
    ]);
  });

  it.each([null, 42])("rejects malformed pass configuration %j without throwing", (passConfig) => {
    const config = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        Flow: passConfig,
      },
    } as unknown as ShaderConfig;

    expect(() => buildSlangPassGraph({
      imageCode,
      config,
      buffers: { Flow: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    })).not.toThrow();

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { Flow: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });
    expect(graph.errors).toContain("Flow: Pass configuration must be an object");
    expect(graph.passes.map(({ name }) => name)).toEqual(["Image"]);
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
      { kind: "buffer", slot: 0, key: "iChannel0", source: "BufferA", readFrom: "current-frame" },
      { kind: "buffer", slot: 1, key: "iChannel1", source: "BufferB", readFrom: "current-frame" },
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

describe("texture, video, and keyboard channels", () => {
  const imageCode = "float4 mainImage(float2 c){return float4(1);}";

  it("resolves a texture input with resolved_path preferred over path", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: {
        iChannel0: { type: "texture", path: "img.png", resolved_path: "/abs/img.png", filter: "linear", wrap: "clamp", vflip: false, grayscale: true },
      } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.errors).toEqual([]);
    expect(graph.passes[0].channels).toEqual([{
      kind: "texture", slot: 0, key: "iChannel0", path: "/abs/img.png",
      filter: "linear", wrap: "clamp", vflip: false, grayscale: true,
    }]);
  });

  it("falls back to path when resolved_path is absent", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: { iChannel0: { type: "texture", path: "img.png" } } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.passes[0].channels[0]).toMatchObject({ kind: "texture", path: "img.png" });
  });

  it("errors when a texture input has no path", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: { iChannel0: { type: "texture", path: "" } } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.errors).toEqual(["Image: iChannel0 texture input is missing a path"]);
  });

  it("resolves a video input with resolved_path preferred over path", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: {
        iChannel0: { type: "video", path: "clip.mp4", resolved_path: "/abs/clip.mp4", filter: "nearest", wrap: "repeat", vflip: false },
      } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.errors).toEqual([]);
    expect(graph.warnings).toEqual([]);
    expect(graph.passes[0].channels).toEqual([{
      kind: "video", slot: 0, key: "iChannel0", path: "/abs/clip.mp4",
      filter: "nearest", wrap: "repeat", vflip: false,
    }]);
  });

  it("falls back to video path when resolved_path is absent", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: { iChannel0: { type: "video", path: "clip.mp4" } } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.passes[0].channels[0]).toMatchObject({ kind: "video", path: "clip.mp4" });
  });

  it("errors when a video input has no path", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: { iChannel0: { type: "video", path: "" } } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.errors).toEqual(["Image: iChannel0 video input is missing a path"]);
    expect(graph.passes[0].channels).toEqual([]);
  });

  it("carries muted on video channels", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: {
        iChannel0: { type: "video", path: "v.mp4", muted: true },
      } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.passes[0].channels[0]).toMatchObject({ kind: "video", muted: true });
  });

  it("resolves a cubemap input with resolved_path preferred over path", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: {
        iChannel0: {
          type: "cubemap",
          path: "sky-cross.png",
          resolved_path: "/abs/sky-cross.png",
          filter: "mipmap",
          wrap: "clamp",
          vflip: true,
        },
      } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.warnings).toEqual([]);
    expect(graph.passes[0].channels).toEqual([{
      kind: "cubemap", slot: 0, key: "iChannel0", path: "/abs/sky-cross.png",
      filter: "mipmap", wrap: "clamp", vflip: true,
    }]);
  });

  it("falls back to cubemap path when resolved_path is absent", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: { iChannel0: { type: "cubemap", path: "sky-cross.png" } } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0].channels[0]).toMatchObject({ kind: "cubemap", path: "sky-cross.png" });
  });

  it("errors when a cubemap input has no path", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: { iChannel0: { type: "cubemap", path: "" } } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });

    expect(graph.errors).toEqual(["Image: iChannel0 cubemap input is missing a path"]);
    expect(graph.passes[0].channels).toEqual([]);
  });

  it("resolves a keyboard input", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: { iChannel1: { type: "keyboard" } } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.passes[0].channels).toEqual([{ kind: "keyboard", slot: 1, key: "iChannel1" }]);
  });

  it("still warns on audio inputs", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: {
        iChannel0: { type: "audio", path: "a.mp3" },
      } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.warnings).toEqual([
      'Image: iChannel0 uses unsupported Slang/WebGPU input type "audio"',
    ]);
    expect(graph.passes[0].channels).toEqual([]);
  });

  it("sorts mixed channel kinds by slot", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: {
        BufferA: { path: "a.slang" },
        Image: { inputs: {
          iChannel2: { type: "keyboard" },
          iChannel0: { type: "texture", path: "t.png" },
          iChannel1: { type: "buffer", source: "BufferA" },
          iChannel3: { type: "video", path: "v.mp4" },
          iChannel4: { type: "cubemap", path: "sky.png" },
        } },
      } },
      buffers: { BufferA: "float4 mainImage(float2 c){return float4(0);}" },
      canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.passes.map(p => p.name)).toEqual(["BufferA", "Image"]);
    expect(graph.passes[1].channels.map(c => [c.kind, c.slot])).toEqual([
      ["texture", 0], ["buffer", 1], ["keyboard", 2], ["video", 3], ["cubemap", 4],
    ]);
  });
});

describe("Slang compute passes", () => {
  function build(config: ShaderConfig, buffers: Record<string, string> = {}) {
    return buildSlangPassGraph({
      imageCode,
      config,
      buffers,
      canvasWidth: 320,
      canvasHeight: 180,
    });
  }

  it("classifies Compute-prefixed names and groups compute passes before render passes", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        Flow: { path: "flow.slang", inputs: {} },
        ComputeNormals: { path: "normals.slang", inputs: {} },
        BufferZ: { path: "z.slang", inputs: {} },
        ComputeParticles: { path: "particles.slang", inputs: {} },
      },
    };

    const graph = build(config, {
      Flow: imageCode,
      ComputeNormals: imageCode,
      BufferZ: imageCode,
      ComputeParticles: imageCode,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.map(({ name, kind }) => [name, kind])).toEqual([
      ["ComputeNormals", "compute"],
      ["ComputeParticles", "compute"],
      ["Flow", "render"],
      ["BufferZ", "render"],
      ["Image", "render"],
    ]);
  });

  it("only gives sampled compute passes texture output and carries a valid sampled layer", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeSampled", layer: 2 } } },
        ComputeUnused: { path: "unused.slang", outputLayers: 2 },
        ComputeSampled: { path: "sampled.slang", outputLayers: 3 },
      },
    };

    const graph = build(config, { ComputeUnused: imageCode, ComputeSampled: imageCode });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.find(({ name }) => name === "ComputeUnused")).toMatchObject({
      output: "none",
      outputLayers: 2,
    });
    expect(graph.passes.find(({ name }) => name === "ComputeSampled")).toMatchObject({
      output: "texture",
      outputLayers: 3,
    });
    expect(graph.passes.find(({ name }) => name === "Image")?.channels).toEqual([
      {
        kind: "buffer",
        slot: 0,
        key: "iChannel0",
        source: "ComputeSampled",
        layer: 2,
        readFrom: "current-frame",
      },
    ]);
  });

  it("detects sampled compute output even when its consumer is declared first", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        Flow: { path: "flow.slang", inputs: { iChannel0: { type: "buffer", source: "ComputeLate" } } },
        ComputeLate: { path: "late.slang" },
      },
    };

    const graph = build(config, { Flow: imageCode, ComputeLate: imageCode });

    expect(graph.passes.find(({ name }) => name === "ComputeLate")?.output).toBe("texture");
  });

  it("keeps compute output disabled when its only raw reference is an ignored input", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { ignored: { type: "buffer", source: "ComputeSim" } } },
        ComputeSim: { path: "compute.slang" },
      },
    };

    const graph = build(config, { ComputeSim: imageCode });

    expect(graph.warnings).toContain('Image: ignoring non-iChannel input "ignored"');
    expect(graph.passes.find(({ name }) => name === "ComputeSim")?.output).toBe("none");
  });

  it.each([
    [undefined, { mode: "texel" }, [8, 8, 1]],
    [{ count: 1024 }, { mode: "count", count: 1024 }, [64, 1, 1]],
    [{ x: 3, y: 4, z: 5 }, { mode: "workgroups", x: 3, y: 4, z: 5 }, [8, 8, 1]],
    [{ cover: "particles" }, { mode: "cover-storage", name: "particles" }, [8, 8, 1]],
    [{ cover: "iChannel3" }, { mode: "cover-channel", key: "iChannel3" }, [8, 8, 1]],
  ] as const)("resolves dispatch %j", (dispatch, expectedDispatch, expectedWorkgroupSize) => {
    const graph = build({
      version: "1",
      storage: { particles: { count: 16, stride: 16, elementType: "float4" } },
      passes: {
        Image: { inputs: {} },
        ComputeMain: {
          path: "compute.slang",
          inputs: { iChannel3: { type: "texture", path: "input.png" } },
          dispatch,
        },
      },
    }, { ComputeMain: imageCode });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0]).toMatchObject({
      dispatch: expectedDispatch,
      workgroupSize: expectedWorkgroupSize,
    });
  });

  it("rejects dispatch cover for an input ignored during channel resolution", () => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: {
          path: "compute.slang",
          inputs: { foo: { type: "texture", path: "input.png" } },
          dispatch: { cover: "foo" },
        },
      },
    }, { ComputeMain: imageCode });

    expect(graph.warnings).toContain('ComputeMain: ignoring non-iChannel input "foo"');
    expect(graph.errors).toContain('ComputeMain: dispatch cover target "foo" was not found');
    expect(graph.passes[0]).toMatchObject({ dispatch: { mode: "texel" }, channels: [] });
  });

  it("uses a valid workgroup override and propagates dispatch repeat settings", () => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: {
          path: "compute.slang",
          dispatch: { count: 8 },
          dispatchCount: 3,
          dispatchOnce: false,
          workgroupSize: [16, 4, 2],
        },
      },
    }, { ComputeMain: imageCode });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0]).toMatchObject({
      dispatch: { mode: "count", count: 8 },
      dispatchCount: 3,
      dispatchOnce: false,
      workgroupSize: [16, 4, 2],
    });
  });

  it.each([
    [{ count: 0 }, "count must be a positive integer"],
    [{ count: 1.5 }, "count must be a positive integer"],
    [{ x: 1, y: 0, z: 1 }, "x, y, and z must be positive integers"],
    [{ x: 1, y: 2.5, z: 1 }, "x, y, and z must be positive integers"],
    [{ cover: "missing" }, 'cover target "missing" was not found'],
    [{}, "invalid dispatch shape"],
    [{ count: 1, x: 1, y: 1, z: 1 }, "invalid dispatch shape"],
  ])("reports invalid dispatch %j and falls back safely", (dispatch, expectedError) => {
    const config = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang", dispatch },
      },
    } as unknown as ShaderConfig;

    const graph = build(config, { ComputeMain: imageCode });

    expect(graph.errors.some((error) => error.includes(expectedError))).toBe(true);
    expect(graph.passes[0].dispatch).toEqual({ mode: "texel" });
    expect(graph.passes[0].workgroupSize).toEqual([8, 8, 1]);
  });

  it.each([0, -1, 1.5])("reports invalid dispatchCount %s and falls back to one", (dispatchCount) => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang", dispatchCount },
      },
    } as ShaderConfig, { ComputeMain: imageCode });

    expect(graph.errors.some((error) => error.includes("dispatchCount must be a positive integer"))).toBe(true);
    expect(graph.passes[0].dispatchCount).toBe(1);
  });

  it.each([
    [[8, 8], "exactly 3"],
    [[8, 8, 1, 1], "exactly 3"],
    [[8, 0, 1], "positive integers"],
    [[8, 1.5, 1], "positive integers"],
    [[16, 16, 2], "product must be at most 256"],
  ])("reports invalid workgroupSize %j and uses the dispatch-mode default", (workgroupSize, expectedError) => {
    const config = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang", dispatch: { count: 16 }, workgroupSize },
      },
    } as unknown as ShaderConfig;

    const graph = build(config, { ComputeMain: imageCode });

    expect(graph.errors.some((error) => error.includes(expectedError))).toBe(true);
    expect(graph.passes[0].workgroupSize).toEqual([64, 1, 1]);
  });

  it("reports dispatchOnce combined with repeated dispatches", () => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang", dispatchOnce: true, dispatchCount: 2 },
      },
    }, { ComputeMain: imageCode });

    expect(graph.errors.some((error) => error.includes("dispatchOnce") && error.includes("dispatchCount"))).toBe(true);
    expect(graph.passes[0]).toMatchObject({ dispatchOnce: true, dispatchCount: 2 });
  });

  it.each([null, "true", 1])("reports invalid dispatchOnce %j and falls back to false", (dispatchOnce) => {
    const config = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang", dispatchOnce },
      },
    } as unknown as ShaderConfig;

    const graph = build(config, { ComputeMain: imageCode });

    expect(graph.errors).toContain("ComputeMain: dispatchOnce must be a boolean");
    expect(graph.passes[0].dispatchOnce).toBe(false);
  });

  it.each([0, 1.5, 9])("reports invalid outputLayers %s and falls back to one", (outputLayers) => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang", outputLayers },
      },
    }, { ComputeMain: imageCode });

    expect(graph.errors.some((error) => error.includes("outputLayers must be an integer from 1 to 8"))).toBe(true);
    expect(graph.passes[0].outputLayers).toBe(1);
  });

  it("reports a missing compute source with its configured path", () => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang" },
      },
    });

    expect(graph.errors).toContain('ComputeMain: Buffer file not found or is empty (path: "compute.slang")');
    expect(graph.passes.map(({ name }) => name)).toEqual(["Image"]);
  });
});

describe("Slang storage graph", () => {
  function build(storage: ShaderConfig["storage"]) {
    return buildSlangPassGraph({
      imageCode,
      config: { version: "1", storage, passes: { Image: { inputs: {} } } },
      buffers: {},
      canvasWidth: 64,
      canvasHeight: 64,
    });
  }

  it("preserves declaration order, trims types, assigns dense bindings, and identifies builtins", () => {
    const graph = build({
      positions: { count: 4, stride: 16, elementType: "  float4  " },
      custom: { count: 2, stride: 32, elementType: "Particle" },
      counter: { count: 1, stride: 4, elementType: "Atomic<uint>" },
    });

    expect(graph.errors).toEqual([]);
    expect(graph.storage).toEqual([
      { name: "positions", binding: 0, elementType: "float4", builtin: true, count: 4, stride: 16 },
      { name: "custom", binding: 1, elementType: "Particle", builtin: false, count: 2, stride: 32 },
      { name: "counter", binding: 2, elementType: "Atomic<uint>", builtin: true, count: 1, stride: 4 },
    ]);
  });

  it.each([0, -1, 1.5])("rejects storage with invalid count %s", (count) => {
    const graph = build({ invalid: { count, stride: 4, elementType: "float" } });
    expect(graph.errors).toContain("Storage invalid: count must be a positive integer");
    expect(graph.storage).toEqual([]);
  });

  it.each([0, -1, 1.5])("rejects storage with invalid stride %s", (stride) => {
    const graph = build({ invalid: { count: 1, stride, elementType: "float" } });
    expect(graph.errors).toContain("Storage invalid: stride must be a positive integer");
    expect(graph.storage).toEqual([]);
  });

  it.each(["", "   "])("rejects storage with empty elementType %j", (elementType) => {
    const graph = build({ invalid: { count: 1, stride: 4, elementType } });
    expect(graph.errors).toContain("Storage invalid: elementType is required");
    expect(graph.storage).toEqual([]);
  });

  it("rejects storage with a non-string elementType from runtime JSON", () => {
    const graph = build({
      invalid: { count: 1, stride: 4, elementType: null },
    } as unknown as ShaderConfig["storage"]);
    expect(graph.errors).toContain("Storage invalid: elementType is required");
    expect(graph.storage).toEqual([]);
  });

  it("assigns bindings among emitted nodes when an earlier declaration is invalid", () => {
    const graph = build({
      invalid: { count: 0, stride: 4, elementType: "float" },
      valid: { count: 1, stride: 4, elementType: "float" },
    });
    expect(graph.storage[0].binding).toBe(0);
  });

  it("warns but does not error when storage exceeds the WebGPU baseline of 8 buffers", () => {
    const storage = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      `data${index}`,
      { count: 1, stride: 4, elementType: "float" },
    ]));
    const graph = build(storage);

    expect(graph.errors).toEqual([]);
    expect(graph.storage).toHaveLength(9);
    expect(graph.warnings.some((warning) =>
      warning.includes("WebGPU baseline 8")
      && warning.includes("adapter support")
      && warning.includes("packing")
    )).toBe(true);
  });

  it("reports total valid storage larger than 256 MiB", () => {
    const graph = build({ huge: { count: 268_435_457, stride: 1, elementType: "uint" } });

    expect(graph.errors.some((error) => error.includes("256 MiB"))).toBe(true);
    expect(graph.storage).toHaveLength(1);
  });
});

describe("Slang pass references", () => {
  function build(config: ShaderConfig, buffers: Record<string, string>) {
    return buildSlangPassGraph({
      imageCode,
      config,
      buffers,
      canvasWidth: 128,
      canvasHeight: 64,
    });
  }

  it.each([-1, 1.5, 3])("rejects invalid compute output layer %s", (layer) => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeMain", layer } } },
        ComputeMain: { path: "compute.slang", outputLayers: 3 },
      },
    };
    const graph = build(config, { ComputeMain: imageCode });

    expect(graph.errors.some((error) => error.includes("layer") && error.includes("ComputeMain"))).toBe(true);
    expect(graph.passes.find(({ name }) => name === "Image")?.channels).toEqual([]);
  });

  it("rejects an explicitly null buffer layer from runtime JSON", () => {
    const config = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "ComputeMain", layer: null } } },
        ComputeMain: { path: "compute.slang", outputLayers: 2 },
      },
    } as unknown as ShaderConfig;
    const graph = build(config, { ComputeMain: imageCode });

    expect(graph.errors).toContain(
      'Image: iChannel0 layer null is invalid for source "ComputeMain" with 2 layer(s)',
    );
    expect(graph.passes.find(({ name }) => name === "Image")?.channels).toEqual([]);
  });

  it("rejects a nonzero layer from a single-layer render source", () => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "Flow", layer: 1 } } },
        Flow: { path: "flow.slang" },
      },
    }, { Flow: imageCode });

    expect(graph.errors.some((error) => error.includes("layer 1") && error.includes("Flow"))).toBe(true);
  });

  it("uses final frame order for current-frame and previous-frame reads across pass groups", () => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "RenderLate" } } },
        RenderEarly: {
          path: "early.slang",
          inputs: {
            iChannel0: { type: "buffer", source: "ComputeLate" },
            iChannel1: { type: "buffer", source: "RenderLate" },
            iChannel2: { type: "buffer", source: "RenderEarly" },
          },
        },
        ComputeEarly: {
          path: "compute-early.slang",
          inputs: {
            iChannel0: { type: "buffer", source: "RenderEarly" },
            iChannel1: { type: "buffer", source: "ComputeLate" },
            iChannel2: { type: "buffer", source: "ComputeEarly" },
          },
        },
        RenderLate: {
          path: "late.slang",
          inputs: { iChannel0: { type: "buffer", source: "RenderEarly" } },
        },
        ComputeLate: {
          path: "compute-late.slang",
          inputs: { iChannel0: { type: "buffer", source: "ComputeEarly" } },
        },
      },
    }, {
      RenderEarly: imageCode,
      ComputeEarly: imageCode,
      RenderLate: imageCode,
      ComputeLate: imageCode,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.map(({ name }) => name)).toEqual([
      "ComputeEarly", "ComputeLate", "RenderEarly", "RenderLate", "Image",
    ]);
    const timings = Object.fromEntries(graph.passes.flatMap((pass) => pass.channels
      .filter((channel) => channel.kind === "buffer")
      .map((channel) => [`${pass.name}:${channel.key}`, channel.readFrom])));
    expect(timings).toEqual({
      "ComputeEarly:iChannel0": "previous-frame",
      "ComputeEarly:iChannel1": "previous-frame",
      "ComputeEarly:iChannel2": "previous-frame",
      "ComputeLate:iChannel0": "current-frame",
      "RenderEarly:iChannel0": "current-frame",
      "RenderEarly:iChannel1": "previous-frame",
      "RenderEarly:iChannel2": "previous-frame",
      "RenderLate:iChannel0": "current-frame",
      "Image:iChannel0": "current-frame",
    });
  });
});

describe("SlangPassGraph public helpers", () => {
  it("recognizes only names starting with Compute", () => {
    expect(isComputePassName("Compute")).toBe(true);
    expect(isComputePassName("ComputeParticles")).toBe(true);
    expect(isComputePassName("PreCompute")).toBe(false);
    expect(isComputePassName("computeParticles")).toBe(false);
  });

  it("exports the exact built-in storage type whitelist", () => {
    expect([...BUILTIN_STORAGE_TYPES]).toEqual([
      "float", "float2", "float3", "float4",
      "int", "int2", "int3", "int4",
      "uint", "uint2", "uint3", "uint4",
      "Atomic<uint>", "Atomic<int>",
      "float2x2", "float3x3", "float4x4",
    ]);
  });
});
