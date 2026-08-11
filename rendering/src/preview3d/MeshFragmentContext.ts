import {
  SHADER_STUDIO_FRAGMENT_CONTEXT,
  type GeometryType,
} from "@shader-studio/types";

/** Public fragment names shared by the generated GLSL and Slang adapters. */
export const MESH_FRAGMENT_CONTEXT = {
  uv: "_meshUv",
  worldPosition: SHADER_STUDIO_FRAGMENT_CONTEXT.worldPosition.name,
  normal: SHADER_STUDIO_FRAGMENT_CONTEXT.normal.name,
  cameraPosition: SHADER_STUDIO_FRAGMENT_CONTEXT.cameraPosition.name,
} as const;

/** GLSL wrapper types derived from the shared authoring/runtime facts. */
export const MESH_FRAGMENT_CONTEXT_TYPES = {
  worldPosition: SHADER_STUDIO_FRAGMENT_CONTEXT.worldPosition.glslType,
  normal: SHADER_STUDIO_FRAGMENT_CONTEXT.normal.glslType,
  cameraPosition: SHADER_STUDIO_FRAGMENT_CONTEXT.cameraPosition.glslType,
} as const;

/** Omitted geometry is fullscreen for backwards-compatible compiler calls. */
export function isMeshGeometry(geometry?: GeometryType): boolean {
  return geometry !== undefined && geometry !== "fullscreen";
}
