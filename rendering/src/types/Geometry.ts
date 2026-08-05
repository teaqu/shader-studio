import type { GeometryType } from "@shader-studio/types";

export const DEFAULT_GEOMETRY: GeometryType = "fullscreen";

export function resolvePassGeometry(
  pass: { geometry?: { type: GeometryType } } | undefined,
): GeometryType {
  return pass?.geometry?.type ?? DEFAULT_GEOMETRY;
}
