import { describe, expect, it } from "vitest";
import {
  blendFormatFallbackWarning,
  resolveBlendedBufferFormat,
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

  describe("blending into rgba32float", () => {
    const reason = "rgba32float blending is unavailable on this device";

    it.each(["alpha", "premultiplied", "additive"] as const)("falls %s back to rgba16float without float32 blending", (blend) => {
      expect(resolveBlendedBufferFormat("rgba32float", blend, false)).toEqual({ format: "rgba16float", fallbackReason: reason });
    });

    it("keeps rgba32float when the device can blend it, when blending is off, and for rgba16float", () => {
      expect(resolveBlendedBufferFormat("rgba32float", "additive", true)).toEqual({ format: "rgba32float" });
      expect(resolveBlendedBufferFormat("rgba32float", "none", false)).toEqual({ format: "rgba32float" });
      expect(resolveBlendedBufferFormat("rgba32float", undefined, false)).toEqual({ format: "rgba32float" });
      expect(resolveBlendedBufferFormat("rgba16float", "alpha", false)).toEqual({ format: "rgba16float" });
    });

    it("names the pass in the warning", () => {
      expect(blendFormatFallbackWarning("BufferA")).toBe(`BufferA: renders into rgba16float because ${reason}`);
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
      expect(graph.warnings).toEqual([blendFormatFallbackWarning("Glow")]);
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
