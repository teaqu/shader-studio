import { describe, expect, it } from "vitest";
import { resolveBufferFormat, resolveBufferSampling } from "../../util/BufferFormatResolver";

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
});
