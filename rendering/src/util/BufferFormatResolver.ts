import type { RenderPassGraph } from "../types/PassGraph";

export type BufferOutputFormat = "auto" | "rgba16float" | "rgba32float";
export type ResolvedBufferFormat = Exclude<BufferOutputFormat, "auto">;
export type BufferFilter = "linear" | "nearest" | "mipmap";

export interface BufferFormatCapabilities {
  rgba16floatRenderable: boolean;
  rgba32floatRenderable: boolean;
  float32Filterable: boolean;
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
    if (pass.output === "canvas") continue;
    try {
      pass.resolvedOutputFormat = resolveBufferFormat(pass.outputFormat, capabilities);
      formats.set(pass.name, pass.resolvedOutputFormat);
    } catch (error) {
      graph.errors.push(`${pass.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const pass of graph.passes) {
    for (const channel of pass.channels) {
      if (channel.kind !== "buffer") continue;
      const format = formats.get(channel.source);
      if (!format) continue;
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
