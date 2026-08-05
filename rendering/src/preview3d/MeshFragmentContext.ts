import type { GeometryType } from "@shader-studio/types";

/** Public fragment names shared by the generated GLSL and Slang adapters. */
export const MESH_FRAGMENT_CONTEXT = {
  uv: "_meshUv",
  worldPosition: "iWorldPosition",
  normal: "iNormal",
  cameraPosition: "iCameraPosition",
} as const;

/** Omitted geometry is fullscreen for backwards-compatible compiler calls. */
export function isMeshGeometry(geometry?: GeometryType): boolean {
  return geometry !== undefined && geometry !== "fullscreen";
}
