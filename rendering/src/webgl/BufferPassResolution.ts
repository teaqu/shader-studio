import type { BufferResolution, ShaderConfig } from "@shader-studio/types";
import { clampSizeToWebGLRenderLimits, type WebGLRenderLimits } from "./WebGLRenderLimits";

export interface BufferPassSize {
  width: number;
  height: number;
}

export function resolveBufferPassSize(
  passConfig: { resolution?: BufferResolution } | undefined,
  canvasWidth: number,
  canvasHeight: number,
  limits?: WebGLRenderLimits | null,
): BufferPassSize {
  const width = Math.max(1, Math.round(canvasWidth));
  const height = Math.max(1, Math.round(canvasHeight));
  const resolution = passConfig?.resolution;

  if (!resolution) {
    return clampSizeToWebGLRenderLimits(width, height, limits);
  }

  if ("width" in resolution && "height" in resolution && resolution.width && resolution.height) {
    return clampSizeToWebGLRenderLimits(
      resolution.width * (resolution.scale ?? 1),
      resolution.height * (resolution.scale ?? 1),
      limits,
    );
  }

  if ("scale" in resolution && typeof resolution.scale === "number") {
    return clampSizeToWebGLRenderLimits(
      width * resolution.scale,
      height * resolution.scale,
      limits,
    );
  }

  return clampSizeToWebGLRenderLimits(width, height, limits);
}

export function buildBufferPassSizes(
  config: ShaderConfig | null,
  canvasWidth: number,
  canvasHeight: number,
  limits?: WebGLRenderLimits | null,
): Record<string, BufferPassSize> | undefined {
  const passes = config?.passes;
  if (!passes) {
    return undefined;
  }

  const sizes: Record<string, BufferPassSize> = {};
  for (const [name, passConfig] of Object.entries(passes)) {
    if (
      name === "Image" ||
      name === "common" ||
      name === "vertex" ||
      !passConfig ||
      !("path" in passConfig)
    ) {
      continue;
    }
    sizes[name] = resolveBufferPassSize(passConfig, canvasWidth, canvasHeight, limits);
  }

  return Object.keys(sizes).length > 0 ? sizes : undefined;
}
