import { describe, expect, it } from "vitest";
import type { BufferPass, ShaderConfig } from "@shader-studio/types";
import {
  BUILTIN_STORAGE_TYPES,
  MAX_COMPUTE_DISPATCH_COUNT,
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

  it("creates arbitrary configured buffer passes in declaration order before Image", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { iChannel0: { type: "buffer", source: "BlurPass" } } },
        GBuffer: { path: "gbuffer.slang", inputs: {} },
        BlurPass: { path: "blur.slang", inputs: {} },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { GBuffer: imageCode, BlurPass: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.map((pass) => pass.name)).toEqual(["GBuffer", "BlurPass", "Image"]);
    expect(graph.passes.at(-1)?.channels).toEqual([
      {
        kind: "buffer",
        slot: 0,
        key: "iChannel0",
        source: "BlurPass",
        readFrom: "current-frame",
      },
    ]);
  });

  it("creates more than four configured buffer passes", () => {
    const names = ["First", "Second", "Third", "Fourth", "Fifth"];
    const passes = Object.fromEntries(
      names.map((name) => [name, { path: `${name}.slang`, inputs: {} }]),
    );
    const buffers = Object.fromEntries(names.map((name) => [name, imageCode]));

    const graph = buildSlangPassGraph({
      imageCode,
      config: {
        version: "1",
        passes: { Image: { inputs: {} }, ...passes },
      } as ShaderConfig,
      buffers,
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.map((pass) => pass.name)).toEqual([...names, "Image"]);
  });

  it("marks arbitrary buffer pass inputs as previous-frame reads so self-feedback is valid", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: {} },
        FeedbackState: {
          path: "feedback.slang",
          inputs: { iChannel0: { type: "buffer", source: "FeedbackState" } },
        },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { FeedbackState: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes.find((pass) => pass.name === "FeedbackState")?.channels).toEqual([
      {
        kind: "buffer",
        slot: 0,
        key: "iChannel0",
        source: "FeedbackState",
        readFrom: "previous-frame",
      },
    ]);
  });

  it("matches sequential GLSL timing for cross-buffer dependencies", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        BufferA: {
          path: "a.slang",
          inputs: { iChannel0: { type: "buffer", source: "BufferB" } },
        },
        BufferB: {
          path: "b.slang",
          inputs: {
            iChannel0: { type: "buffer", source: "BufferA" },
            iChannel1: { type: "buffer", source: "BufferB" },
          },
        },
        Image: { inputs: { iChannel0: { type: "buffer", source: "BufferB" } } },
      },
    };

    const graph = buildSlangPassGraph({
      imageCode,
      config,
      buffers: { BufferA: imageCode, BufferB: imageCode },
      canvasWidth: 128,
      canvasHeight: 64,
    });

    const bufferA = graph.passes.find((pass) => pass.name === "BufferA")!;
    const bufferB = graph.passes.find((pass) => pass.name === "BufferB")!;
    const image = graph.passes.find((pass) => pass.name === "Image")!;
    expect(bufferA.channels[0]).toMatchObject({ source: "BufferB", readFrom: "previous-frame" });
    expect(bufferB.channels[0]).toMatchObject({ source: "BufferA", readFrom: "current-frame" });
    expect(bufferB.channels[1]).toMatchObject({ source: "BufferB", readFrom: "previous-frame" });
    expect(image.channels[0]).toMatchObject({ source: "BufferB", readFrom: "current-frame" });
  });

  it("accepts audio inputs while reporting missing buffer sources", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: {
          inputs: {
            iChannel0: { type: "audio", path: "noise.mp3" },
            iChannel1: { type: "buffer", source: "MissingPass" },
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
    expect(graph.errors).toContain("Image: iChannel1 references missing buffer \"MissingPass\"");
    expect(graph.warnings).toEqual([]);
    expect(graph.passes.find((pass) => pass.name === "Image")?.channels).toContainEqual({
      kind: "audio", slot: 0, key: "iChannel0", path: "noise.mp3",
    });
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

  it("assigns custom input names to slots in declaration order", () => {
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
    expect(graph.warnings).toEqual([]);
    expect(graph.passes.find((pass) => pass.name === "Image")?.channels).toEqual([
      {
        kind: "buffer",
        slot: 0,
        key: "myTexture",
        source: "BufferA",
        readFrom: "current-frame",
      },
    ]);
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
    expect(graph.warnings).toContain("Image: ignoring channel input \"iChannel16\" above slot 15");
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

  it("preserves declaration-order slot assignment for out-of-order numeric aliases", () => {
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
      { kind: "buffer", slot: 0, key: "iChannel1", source: "BufferB", readFrom: "current-frame" },
      { kind: "buffer", slot: 1, key: "iChannel0", source: "BufferA", readFrom: "current-frame" },
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

describe("file and input channels", () => {
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
    expect(graph.passes[0].channels).toEqual([{ kind: "keyboard", slot: 0, key: "iChannel1" }]);
  });

  it("resolves audio inputs with playback options", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: {
        iChannel1: {
          type: "audio",
          path: "a.mp3",
          resolved_path: "/abs/a.wav",
          muted: true,
          startTime: 0.25,
          endTime: 2.5,
        },
      } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.errors).toEqual([]);
    expect(graph.warnings).toEqual([]);
    expect(graph.passes[0].channels).toEqual([{
      kind: "audio",
      slot: 0,
      key: "iChannel1",
      path: "/abs/a.wav",
      muted: true,
      startTime: 0.25,
      endTime: 2.5,
    }]);
  });

  it("falls back to the audio path when resolved_path is absent", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: {
        iChannel0: { type: "audio", path: "a.mp3" },
      } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.passes[0].channels[0]).toMatchObject({ kind: "audio", path: "a.mp3" });
  });

  it("errors when an audio input has no path", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: { version: "1", passes: { Image: { inputs: {
        iChannel0: { type: "audio", path: "" },
      } } } },
      buffers: {}, canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.errors).toEqual(["Image: iChannel0 audio input is missing a path"]);
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
          iChannel5: { type: "audio", path: "a.wav" },
        } },
      } },
      buffers: { BufferA: "float4 mainImage(float2 c){return float4(0);}" },
      canvasWidth: 100, canvasHeight: 50,
    });
    expect(graph.passes.map(p => p.name)).toEqual(["BufferA", "Image"]);
    expect(graph.passes[1].channels.map(c => [c.kind, c.slot])).toEqual([
      ["keyboard", 0], ["texture", 1], ["buffer", 2], ["video", 3], ["cubemap", 4], ["audio", 5],
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

  it("enables compute output when referenced through a custom channel name", () => {
    const config: ShaderConfig = {
      version: "1",
      passes: {
        Image: { inputs: { ignored: { type: "buffer", source: "ComputeSim" } } },
        ComputeSim: { path: "compute.slang" },
      },
    };

    const graph = build(config, { ComputeSim: imageCode });

    expect(graph.warnings).toEqual([]);
    expect(graph.passes.find(({ name }) => name === "ComputeSim")?.output).toBe("texture");
    expect(graph.passes.find(({ name }) => name === "Image")?.channels).toContainEqual({
      kind: "buffer",
      slot: 0,
      key: "ignored",
      source: "ComputeSim",
      readFrom: "current-frame",
    });
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

  it("resolves dispatch cover for a custom named input", () => {
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

    expect(graph.warnings).toEqual([]);
    expect(graph.errors).toEqual([]);
    expect(graph.passes[0]).toMatchObject({
      dispatch: { mode: "cover-channel", key: "foo" },
      channels: [{ kind: "texture", slot: 0, key: "foo", path: "input.png" }],
    });
  });

  it("uses the dispatch default instead of the legacy config workgroup size", () => {
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
      workgroupSize: [64, 1, 1],
    });
  });

  it("accepts a larger workgroup when the active device reports sufficient limits", () => {
    const graph = buildSlangPassGraph({
      imageCode,
      config: {
        version: "1",
        passes: {
          Image: { inputs: {} },
          ComputeMain: { path: "compute.slang", workgroupSize: [32, 32, 1] },
        },
      },
      buffers: { ComputeMain: `[shader("compute")] [numthreads(32, 32, 1)] void largeKernel(uint3 id : SV_DispatchThreadID) {}` },
      canvasWidth: 320,
      canvasHeight: 180,
      computeWorkgroupLimits: { maxInvocations: 1024, maxSizeX: 1024, maxSizeY: 1024, maxSizeZ: 64 },
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0].workgroupSize).toEqual([32, 32, 1]);
  });

  it("uses the config-selected entrypoint from a multi-entry compute source", () => {
    const graph = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "kernels.slang", entryPoint: "draw" },
      },
    }, {
      ComputeMain: `
        [shader("compute")] [numthreads(64, 1, 1)] void clear(uint3 id : SV_DispatchThreadID) {}
        [shader("compute")] [numthreads(8, 8, 1)] void draw(uint3 id : SV_DispatchThreadID) {}
      `,
    });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0]).toMatchObject({ entryPoint: "draw", workgroupSize: [8, 8, 1] });
  });

  it("selects a configured native entrypoint from a multi-entry compute source", () => {
    const source = `[shader("compute")] [numthreads(1, 1, 1)] void clearKernel(uint3 id : SV_DispatchThreadID) {}
[shader("compute")] [numthreads(64, 1, 1)] void simulateKernel(uint3 id : SV_DispatchThreadID) {}`;
    const graph = build({
      version: "1",
      passes: { Image: { inputs: {} }, ComputeMain: { path: "kernels.slang", entryPoint: "simulateKernel" } },
    }, { ComputeMain: source });

    expect(graph.errors).toEqual([]);
    expect(graph.passes[0]).toMatchObject({ entryPoint: "simulateKernel", workgroupSize: [64, 1, 1] });
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

  it("accepts the dispatchCount safety maximum and rejects the next value", () => {
    const accepted = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang", dispatchCount: MAX_COMPUTE_DISPATCH_COUNT },
      },
    }, { ComputeMain: imageCode });
    const rejected = build({
      version: "1",
      passes: {
        Image: { inputs: {} },
        ComputeMain: { path: "compute.slang", dispatchCount: MAX_COMPUTE_DISPATCH_COUNT + 1 },
      },
    }, { ComputeMain: imageCode });

    expect(accepted.errors).toEqual([]);
    expect(accepted.passes[0].dispatchCount).toBe(MAX_COMPUTE_DISPATCH_COUNT);
    expect(rejected.errors).toContain(
      `ComputeMain: dispatchCount must be at most ${MAX_COMPUTE_DISPATCH_COUNT}`,
    );
    expect(rejected.passes[0].dispatchCount).toBe(1);
  });

  it.each([[8, 8], [8, 8, 1, 1], [8, 0, 1], [8, 1.5, 1], [16, 16, 2]])(
    "ignores legacy workgroupSize %j and uses the dispatch-mode default", (workgroupSize) => {
      const config = {
        version: "1",
        passes: {
          Image: { inputs: {} },
          ComputeMain: { path: "compute.slang", dispatch: { count: 16 }, workgroupSize },
        },
      } as unknown as ShaderConfig;

      const graph = build(config, { ComputeMain: imageCode });

      expect(graph.errors).toEqual([]);
      expect(graph.passes[0].workgroupSize).toEqual([64, 1, 1]);
    },
  );

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
  function build(storage: ShaderConfig["storage"], commonCode = "") {
    return buildSlangPassGraph({
      imageCode,
      config: { version: "1", storage, passes: { Image: { inputs: {} } } },
      buffers: commonCode === "" ? {} : { common: commonCode },
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

  it("warns in config order when common references custom-typed storage", () => {
    const graph = build({
      trails: { count: 2, stride: 16, elementType: "Trail" },
      positions: { count: 2, stride: 16, elementType: "float4" },
      particles: { count: 2, stride: 32, elementType: "Particle" },
    }, `
float4 readParticle(uint index)
{
    return particles[index].position + trails[index].color + positions[index];
}
`);

    expect(graph.errors).toEqual([]);
    expect(graph.warnings).toEqual([
      "Storage \"trails\" uses custom type \"Trail\" and is declared after common, so common cannot reference it; move helpers that access \"trails\" into a pass source file",
      "Storage \"particles\" uses custom type \"Particle\" and is declared after common, so common cannot reference it; move helpers that access \"particles\" into a pass source file",
    ]);
  });

  it("warns when trivia separates custom storage from indexed access", () => {
    const graph = build({
      particles: { count: 2, stride: 32, elementType: "Particle" },
    }, `
float4 readParticle(uint index)
{
    return particles /* storage index follows */
        [index].position;
}
`);

    expect(graph.warnings).toEqual([
      "Storage \"particles\" uses custom type \"Particle\" and is declared after common, so common cannot reference it; move helpers that access \"particles\" into a pass source file",
    ]);
  });

  it("does not warn for builtin or unreferenced custom storage", () => {
    const graph = build({
      positions: { count: 2, stride: 16, elementType: "float4" },
      particles: { count: 2, stride: 32, elementType: "Particle" },
    }, "float4 readPosition(uint index) { return positions[index]; }");

    expect(graph.warnings).toEqual([]);
  });

  it("matches exact identifier tokens and ignores comments, strings, chars, and escapes", () => {
    const graph = build({
      particle: { count: 2, stride: 32, elementType: "Particle" },
      commentsOnly: { count: 2, stride: 32, elementType: "Particle" },
      blockOnly: { count: 2, stride: 32, elementType: "Particle" },
      stringOnly: { count: 2, stride: 32, elementType: "Particle" },
      q: { count: 2, stride: 32, elementType: "Particle" },
    }, String.raw`
float particles = 0;
// commentsOnly[0]
/* blockOnly[0] */
const char* label = "stringOnly and an escaped quote: \" particle \"";
char letter = 'q';
char quote = '\'';
`);

    expect(graph.warnings).toEqual([]);
  });

  it("ignores custom storage names in declarations, shadowing, and member access", () => {
    const graph = build({
      parameter: { count: 2, stride: 32, elementType: "Particle" },
      local: { count: 2, stride: 32, elementType: "Particle" },
      typeName: { count: 2, stride: 32, elementType: "Particle" },
      field: { count: 2, stride: 32, elementType: "Particle" },
      genericField: { count: 2, stride: 32, elementType: "Particle" },
      pointerField: { count: 2, stride: 32, elementType: "Particle" },
      externalType: { count: 2, stride: 32, elementType: "Particle" },
      member: { count: 2, stride: 32, elementType: "Particle" },
    }, `
struct typeName { float4 value; };
struct Holder
{
    float4 field[4];
    Generic<float4> genericField[4];
    float4 *pointerField[4];
    var values : externalType[4];
    float4 member[4];
};
float4 shadowed(float4 parameter)
{
    float4 local[4];
    Holder x;
    return parameter[0] + local[0] + x.member[0];
}
`);

    expect(graph.warnings).toEqual([]);
  });

  it("ignores shadowed storage in comma-separated declarations", () => {
    const graph = build({
      commaLocal: { count: 2, stride: 32, elementType: "Particle" },
      pointerCommaLocal: { count: 2, stride: 32, elementType: "Particle" },
      genericCommaLocal: { count: 2, stride: 32, elementType: "Particle" },
      parameterCommaLocal: { count: 2, stride: 32, elementType: "Particle" },
      initializerCommaLocal: { count: 2, stride: 32, elementType: "Particle" },
      inlineStructCommaLocal: { count: 2, stride: 32, elementType: "Particle" },
      forCommaLocal: { count: 2, stride: 32, elementType: "Particle" },
    }, `
float4 shadowed()
{
    float4 other[4], commaLocal[4];
    float4 *otherPointer[4], pointerCommaLocal[4];
    Generic<float4> otherGeneric[4], genericCommaLocal[4];
    return commaLocal[0] + pointerCommaLocal[0] + genericCommaLocal[0];
}
float4 parameterShadow(float4 other[4], float4 parameterCommaLocal[4])
{
    return parameterCommaLocal[0];
}
float4 initializerShadow()
{
    float4 initialized = { 0, 0, 0, 0 }, initializerCommaLocal[4];
    return initializerCommaLocal[0];
}
struct InlineHolder { float4 value; } holder, inlineStructCommaLocal[4];
float4 inlineStructShadow()
{
    return inlineStructCommaLocal[0].value;
}
float4 forInitializerShadow()
{
    for (float4 other[4], forCommaLocal[4]; false;) {
        return forCommaLocal[0];
    }
    return 0;
}
`);

    expect(graph.warnings).toEqual([]);
  });

  it("warns for indexed storage used after a function argument comma", () => {
    const graph = build({
      particles: { count: 2, stride: 32, elementType: "Particle" },
    }, `
float4 readParticle(uint index)
{
    for (uint loopIndex = 0; loopIndex < 1; loopIndex++) {
        return lerp(float4(0), particles[index].position, 0.5);
    }
    return 0;
}
`);

    expect(graph.warnings).toEqual([
      "Storage \"particles\" uses custom type \"Particle\" and is declared after common, so common cannot reference it; move helpers that access \"particles\" into a pass source file",
    ]);
  });

  it("ignores directive lines and nested code inside an inactive if-zero block", () => {
    const graph = build({
      particles: { count: 2, stride: 32, elementType: "Particle" },
      trails: { count: 2, stride: 16, elementType: "Trail" },
    }, String.raw`
#define READ_PARTICLE particles[0]
#define READ_TRAIL \
    trails[0]
#if 0
float4 inactive = particles[0].position;
#if 1
float4 nested = trails[0].color;
#endif
#endif
#if 0// disabled
float4 adjacentLineComment = particles[0].position;
#endif
#if 0/**/
float4 adjacentBlockComment = trails[0].color;
#endif
`);

    expect(graph.warnings).toEqual([]);
  });

  it("keeps endif text inside inactive multiline comments from ending the region", () => {
    const graph = build({
      particles: { count: 2, stride: 32, elementType: "Particle" },
    }, `
#if 0
/*
#endif
*/
float4 stillInactive = particles[0].position;
#endif
`);

    expect(graph.warnings).toEqual([]);
  });

  it("tracks literal else and elif branches, including nested conditionals", () => {
    const graph = build({
      activeElse: { count: 2, stride: 32, elementType: "Particle" },
      inactiveIf: { count: 2, stride: 32, elementType: "Particle" },
      activeIf: { count: 2, stride: 32, elementType: "Particle" },
      inactiveElse: { count: 2, stride: 32, elementType: "Particle" },
      activeElif: { count: 2, stride: 32, elementType: "Particle" },
      activeFinalElse: { count: 2, stride: 32, elementType: "Particle" },
      nestedActive: { count: 2, stride: 32, elementType: "Particle" },
    }, `
#if 0
float4 a = inactiveIf[0].position;
#else
float4 b = activeElse[0].position;
#endif
#if 1
float4 c = activeIf[0].position;
#else
float4 d = inactiveElse[0].position;
#endif
#if 0
float4 e = inactiveIf[0].position;
#elif 1
float4 f = activeElif[0].position;
#elif 1
float4 g = inactiveIf[0].position;
#endif
#if 0
#elif 0
#else
float4 h = activeFinalElse[0].position;
#endif
#if 0
    #if 0
    float4 i = inactiveIf[0].position;
    #else
    float4 j = inactiveIf[0].position;
    #endif
#else
    #if 1
    float4 k = nestedActive[0].position;
    #endif
#endif
`);

    expect(graph.warnings).toEqual([
      "Storage \"activeElse\" uses custom type \"Particle\" and is declared after common, so common cannot reference it; move helpers that access \"activeElse\" into a pass source file",
      "Storage \"activeIf\" uses custom type \"Particle\" and is declared after common, so common cannot reference it; move helpers that access \"activeIf\" into a pass source file",
      "Storage \"activeElif\" uses custom type \"Particle\" and is declared after common, so common cannot reference it; move helpers that access \"activeElif\" into a pass source file",
      "Storage \"activeFinalElse\" uses custom type \"Particle\" and is declared after common, so common cannot reference it; move helpers that access \"activeFinalElse\" into a pass source file",
      "Storage \"nestedActive\" uses custom type \"Particle\" and is declared after common, so common cannot reference it; move helpers that access \"nestedActive\" into a pass source file",
    ]);
  });

  it("suppresses every branch of conditionals with unknown expressions", () => {
    const graph = build({
      unknownIf: { count: 2, stride: 32, elementType: "Particle" },
      unknownElse: { count: 2, stride: 32, elementType: "Particle" },
      unknownIfdef: { count: 2, stride: 32, elementType: "Particle" },
      unknownIfdefElse: { count: 2, stride: 32, elementType: "Particle" },
      compoundIf: { count: 2, stride: 32, elementType: "Particle" },
      compoundElse: { count: 2, stride: 32, elementType: "Particle" },
      disjunctionIf: { count: 2, stride: 32, elementType: "Particle" },
      disjunctionElse: { count: 2, stride: 32, elementType: "Particle" },
    }, `
#if FEATURE_FLAG
float4 a = unknownIf[0].position;
#else
float4 b = unknownElse[0].position;
#endif
#ifdef OTHER_FLAG
float4 c = unknownIfdef[0].position;
#elif 1
float4 d = unknownIfdefElse[0].position;
#endif
#if 1 && 0
float4 e = compoundIf[0].position;
#else
float4 f = compoundElse[0].position;
#endif
#if 0 || 1
float4 g = disjunctionIf[0].position;
#else
float4 h = disjunctionElse[0].position;
#endif
`);

    expect(graph.warnings).toEqual([]);
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
