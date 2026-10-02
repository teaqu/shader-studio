import {
  DEFAULT_FULLSCREEN_VERTEX_COUNT,
  DEFAULT_VERTEX_TOPOLOGY,
  type GeometryType,
  type VertexTopology,
} from "@shader-studio/types";

export const DEFAULT_GEOMETRY: GeometryType = "fullscreen";

export function resolvePassGeometry(
  pass: { geometry?: { type: GeometryType } } | undefined,
): GeometryType {
  return pass?.geometry?.type ?? DEFAULT_GEOMETRY;
}

/**
 * Configured fullscreen draw fields. Each is present only when the config
 * sets it, so unconfigured passes keep the default draw and generated source.
 */
export interface FullscreenDrawConfig {
  vertexCount?: number;
  topology?: VertexTopology;
}

export function resolveFullscreenDraw(
  pass: { geometry?: { type: GeometryType; vertexCount?: number; topology?: VertexTopology } } | undefined,
): FullscreenDrawConfig {
  const geometry = pass?.geometry;
  if (geometry?.type !== "fullscreen") {
    return {};
  }
  return {
    ...(geometry.vertexCount !== undefined ? { vertexCount: geometry.vertexCount } : {}),
    ...(geometry.topology !== undefined ? { topology: geometry.topology } : {}),
  };
}

/** True when the config changes the default three-vertex triangle-list draw. */
export function hasFullscreenDrawConfig(draw: FullscreenDrawConfig): boolean {
  return draw.vertexCount !== undefined || draw.topology !== undefined;
}

export function fullscreenVertexCount(draw: FullscreenDrawConfig): number {
  return draw.vertexCount ?? DEFAULT_FULLSCREEN_VERTEX_COUNT;
}

export function fullscreenTopology(draw: FullscreenDrawConfig): VertexTopology {
  return draw.topology ?? DEFAULT_VERTEX_TOPOLOGY;
}
