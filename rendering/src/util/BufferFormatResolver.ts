import type { BlendMode, SampleCount } from "@shader-studio/types";
import type { RenderPassGraph } from "../types/PassGraph";
import { resolveRenderState } from "../types/Geometry";

export type BufferOutputFormat = "auto" | "rgba16float" | "rgba32float";
export type ResolvedBufferFormat = Exclude<BufferOutputFormat, "auto">;
export type BufferFilter = "linear" | "nearest" | "mipmap";

export interface BufferFormatCapabilities {
  rgba16floatRenderable: boolean;
  rgba32floatRenderable: boolean;
  float32Filterable: boolean;
  /** WebGPU `float32-blendable` / WebGL `EXT_float_blend`. Absent counts as unavailable. */
  float32Blendable?: boolean;
}

const FLOAT32_BLEND_FALLBACK_REASON = "rgba32float blending is unavailable on this device";
const FLOAT32_MULTISAMPLE_FALLBACK_REASON = "rgba32float cannot be multisampled";

/**
 * The format a buffer pass actually renders into. Blending into rgba32float
 * needs an optional device feature, and WebGPU never multisamples
 * rgba32float, so such passes render into rgba16float instead of failing to
 * draw. WebGL follows the same rule so both backends store the same format.
 */
export function resolveRenderedBufferFormat(
  format: ResolvedBufferFormat,
  settings: { blend?: BlendMode; samples?: SampleCount },
  float32Blendable: boolean,
): { format: ResolvedBufferFormat; fallbackReason?: string } {
  if (format !== "rgba32float") {
    return { format };
  }
  if ((settings.samples ?? 1) > 1) {
    return { format: "rgba16float", fallbackReason: FLOAT32_MULTISAMPLE_FALLBACK_REASON };
  }
  if (settings.blend !== undefined && settings.blend !== "none" && !float32Blendable) {
    return { format: "rgba16float", fallbackReason: FLOAT32_BLEND_FALLBACK_REASON };
  }
  return { format };
}

export function bufferFormatFallbackWarning(passName: string, reason: string): string {
  return `${passName}: renders into rgba16float because ${reason}`;
}

export function resolveBufferFormat(
  requested: BufferOutputFormat | undefined,
  capabilities: BufferFormatCapabilities,
): ResolvedBufferFormat {
  const resolved = requested === undefined || requested === "auto" ? "rgba32float" : requested;
  if (!capabilities[`${resolved}Renderable`]) {
    throw new Error(`${resolved} is not renderable on this device`);
  }
  return resolved;
}

export function resolveBufferSampling(
  requested: BufferFilter,
  format: ResolvedBufferFormat,
  capabilities: BufferFormatCapabilities,
): {
  requested: BufferFilter;
  effective: BufferFilter;
  fallbackReason?: string;
  sampleType: "float" | "unfilterable-float";
  samplerType: "filtering" | "non-filtering";
} {
  if (format === "rgba32float" && !capabilities.float32Filterable) {
    return {
      requested,
      effective: "nearest",
      ...(requested === "nearest" ? {} : {
        fallbackReason: "rgba32float filtering is unavailable on this device",
      }),
      sampleType: "unfilterable-float",
      samplerType: "non-filtering",
    };
  }
  return { requested, effective: requested, sampleType: "float", samplerType: "filtering" };
}

export function resolveGraphBufferFormats(
  graph: RenderPassGraph,
  capabilities: BufferFormatCapabilities,
): void {
  const formats = new Map<string, ResolvedBufferFormat>();
  for (const pass of graph.passes) {
    if (pass.output === "canvas") {
      continue;
    }
    try {
      const rendered = resolveRenderedBufferFormat(
        resolveBufferFormat(pass.outputFormat, capabilities),
        pass.kind === "render" ? { blend: pass.blend, samples: resolveRenderState(pass).samples } : {},
        capabilities.float32Blendable === true,
      );
      pass.resolvedOutputFormat = rendered.format;
      if (rendered.fallbackReason) {
        graph.warnings.push(bufferFormatFallbackWarning(pass.name, rendered.fallbackReason));
      }
      formats.set(pass.name, pass.resolvedOutputFormat);
    } catch (error) {
      graph.errors.push(`${pass.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const pass of graph.passes) {
    for (const channel of pass.channels) {
      if (channel.kind !== "buffer") {
        continue;
      }
      const format = formats.get(channel.source);
      if (!format) {
        continue;
      }
      const sampling = resolveBufferSampling(channel.filter ?? "linear", format, capabilities);
      channel.effectiveFilter = sampling.effective === "mipmap" ? "linear" : sampling.effective;
      channel.sampleType = sampling.sampleType;
      channel.samplerType = sampling.samplerType;
      channel.samplingFallbackReason = sampling.fallbackReason;
      if (sampling.fallbackReason) {
        graph.warnings.push(`${pass.name}: ${channel.key} uses nearest filtering because ${sampling.fallbackReason}`);
      }
    }
  }
}
