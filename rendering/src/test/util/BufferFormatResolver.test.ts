import { describe, expect, it } from "vitest";
import {
  bufferFormatFallbackWarning,
  resolveRenderedBufferFormat,
  resolveBufferFormat,
  resolveBufferSampling,
  resolveGraphBufferFormats,
} from "../../util/BufferFormatResolver";
import type { RenderPassGraph, RenderPassNode } from "../../types/PassGraph";

describe("buffer format resolution", () => {
  const capabilities = { rgba16floatRenderable: true, rgba32floatRenderable: true, float32Filterable: false };

  it.each([undefined, "auto" as const])("defaults %s to rgba32float without coupling precision to filtering", (requested) => {
    expect(resolveBufferFormat(requested, capabilities)).toBe("rgba32float");
  });

  it("honors explicit precision and rejects unsupported storage", () => {
    expect(resolveBufferFormat("rgba16float", capabilities)).toBe("rgba16float");
    expect(resolveBufferFormat("rgba32float", capabilities)).toBe("rgba32float");
    expect(() => resolveBufferFormat("rgba32float", { ...capabilities, rgba32floatRenderable: false }))
      .toThrow(/rgba32float.*not renderable/i);
  });

  it("keeps f32 storage and falls unsupported filtering back to nearest", () => {
    expect(resolveBufferSampling("linear", "rgba32float", capabilities)).toEqual({
      requested: "linear",
      effective: "nearest",
      fallbackReason: "rgba32float filtering is unavailable on this device",
      sampleType: "unfilterable-float",
      samplerType: "non-filtering",
    });
    expect(resolveBufferSampling("nearest", "rgba32float", capabilities)).toEqual({
      requested: "nearest",
      effective: "nearest",
      sampleType: "unfilterable-float",
      samplerType: "non-filtering",
    });
  });

  describe("multisampling rgba32float", () => {
    const reason = "rgba32float cannot be multisampled";

    it("falls a multisampled rgba32float pass back to rgba16float on every device", () => {
      for (const float32Blendable of [true, false]) {
        expect(resolveRenderedBufferFormat("rgba32float", { samples: 4 }, float32Blendable)).toEqual({ format: "rgba16float", fallbackReason: reason });
        expect(resolveRenderedBufferFormat("rgba32float", { samples: 4, blend: "additive" }, float32Blendable))
          .toEqual({ format: "rgba16float", fallbackReason: reason });
      }
    });

    it("keeps rgba32float without multisampling and rgba16float with it", () => {
      expect(resolveRenderedBufferFormat("rgba32float", { samples: 1 }, false)).toEqual({ format: "rgba32float" });
      expect(resolveRenderedBufferFormat("rgba16float", { samples: 4 }, false)).toEqual({ format: "rgba16float" });
    });

    it("warns for multisampled graph buffers, but not fullscreen ones, which never multisample", () => {
      const graph: RenderPassGraph = {
        passes: [
          { name: "Lines", source: "", language: "wgsl", geometry: "vertices", kind: "render", output: "texture", outputLayers: 1, dispatchCount: 1, dispatchOnce: false, workgroupSize: [8, 8, 1], width: 8, height: 8, channels: [], samples: 4 },
          { name: "Flat", source: "", language: "wgsl", geometry: "fullscreen", kind: "render", output: "texture", outputLayers: 1, dispatchCount: 1, dispatchOnce: false, workgroupSize: [8, 8, 1], width: 8, height: 8, channels: [], samples: 4 },
        ],
        storage: [], commonCode: "", warnings: [], errors: [],
      };

      resolveGraphBufferFormats(graph, { ...capabilities, float32Blendable: true });

      expect(graph.passes.map((pass) => pass.resolvedOutputFormat)).toEqual(["rgba16float", "rgba32float"]);
      expect(graph.warnings).toEqual([bufferFormatFallbackWarning("Lines", reason)]);
    });
  });

  describe("blending into rgba32float", () => {
    const reason = "rgba32float blending is unavailable on this device";

    it.each(["alpha", "premultiplied", "additive"] as const)("falls %s back to rgba16float without float32 blending", (blend) => {
      expect(resolveRenderedBufferFormat("rgba32float", { blend }, false)).toEqual({ format: "rgba16float", fallbackReason: reason });
    });

    it("keeps rgba32float when the device can blend it, when blending is off, and for rgba16float", () => {
      expect(resolveRenderedBufferFormat("rgba32float", { blend: "additive" }, true)).toEqual({ format: "rgba32float" });
      expect(resolveRenderedBufferFormat("rgba32float", { blend: "none" }, false)).toEqual({ format: "rgba32float" });
      expect(resolveRenderedBufferFormat("rgba32float", {}, false)).toEqual({ format: "rgba32float" });
      expect(resolveRenderedBufferFormat("rgba16float", { blend: "alpha" }, false)).toEqual({ format: "rgba16float" });
    });

    it("names the pass in the warning", () => {
      expect(bufferFormatFallbackWarning("BufferA", reason)).toBe(`BufferA: renders into rgba16float because ${reason}`);
    });

    const node = (overrides: Partial<RenderPassNode>): RenderPassNode => ({
      name: "BufferA",
      source: "",
      language: "wgsl",
      geometry: "fullscreen",
      kind: "render",
      output: "texture",
      outputLayers: 1,
      dispatchCount: 1,
      dispatchOnce: false,
      workgroupSize: [8, 8, 1],
      width: 8,
      height: 8,
      channels: [],
      ...overrides,
    });
    const graphOf = (...passes: RenderPassNode[]): RenderPassGraph => ({ passes, storage: [], commonCode: "", warnings: [], errors: [] });

    it("resolves graph buffers through the blend fallback and warns once per pass", () => {
      const graph = graphOf(
        node({ name: "Glow", blend: "additive" }),
        node({ name: "Plain" }),
        node({ name: "Half", blend: "alpha", outputFormat: "rgba16float" }),
        node({ name: "Sim", kind: "compute", blend: "additive" } as Partial<RenderPassNode>),
        node({ name: "Image", output: "canvas", blend: "alpha" }),
      );

      resolveGraphBufferFormats(graph, { ...capabilities, float32Blendable: false });

      expect(graph.passes.map((pass) => pass.resolvedOutputFormat)).toEqual(["rgba16float", "rgba32float", "rgba16float", "rgba32float", undefined]);
      expect(graph.warnings).toEqual([bufferFormatFallbackWarning("Glow", reason)]);
    });

    it("treats an unreported float32 blend capability as unavailable", () => {
      const graph = graphOf(node({ blend: "premultiplied" }));

      resolveGraphBufferFormats(graph, capabilities);

      expect(graph.passes[0].resolvedOutputFormat).toBe("rgba16float");
    });

    it("keeps rgba32float for blended buffers on a float32-blendable device", () => {
      const graph = graphOf(node({ blend: "additive" }));

      resolveGraphBufferFormats(graph, { ...capabilities, float32Blendable: true });

      expect(graph.passes[0].resolvedOutputFormat).toBe("rgba32float");
      expect(graph.warnings).toEqual([]);
    });
  });
});
