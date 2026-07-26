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

  it("errors when a channel's buffer source is not a buffer pass name", () => {
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

    expect(graph.errors).toContain(
      "Image: iChannel0 source \"common\" is not a buffer pass",
    );
    expect(graph.errors).toContain(
      "Image: iChannel1 source \"Image\" is not a buffer pass",
    );
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

  it("preserves configured buffer order and places Image last", () => {
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
    expect(graph.passes.map((pass) => pass.name)).toEqual(["BufferB", "BufferA", "Image"]);
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
    expect(graph.passes[0].channels).toEqual([{ kind: "keyboard", slot: 1, key: "iChannel1" }]);
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
      slot: 1,
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
      ["texture", 0], ["buffer", 1], ["keyboard", 2], ["video", 3], ["cubemap", 4], ["audio", 5],
    ]);
  });
});
