import {
  SHADER_STUDIO_FRAGMENT_CONTEXT,
  type GeometryType,
} from "@shader-studio/types";

/** Public fragment names shared by the generated GLSL and Slang adapters. */
export const MESH_FRAGMENT_CONTEXT = {
  uv: SHADER_STUDIO_FRAGMENT_CONTEXT.vertexUv.name,
  worldPosition: SHADER_STUDIO_FRAGMENT_CONTEXT.worldPosition.name,
  normal: SHADER_STUDIO_FRAGMENT_CONTEXT.normal.name,
  cameraPosition: SHADER_STUDIO_FRAGMENT_CONTEXT.cameraPosition.name,
  frontFacing: SHADER_STUDIO_FRAGMENT_CONTEXT.frontFacing.name,
} as const;

/**
 * Built-in written from the native instance index before mainVertex runs and
 * passed flat to the fragment stage; constant 0 for fullscreen geometry.
 */
export const INSTANCE_INDEX = "iInstanceIndex";

/** GLSL wrapper types derived from the shared authoring/runtime facts. */
export const MESH_FRAGMENT_CONTEXT_TYPES = {
  uv: SHADER_STUDIO_FRAGMENT_CONTEXT.vertexUv.glslType,
  worldPosition: SHADER_STUDIO_FRAGMENT_CONTEXT.worldPosition.glslType,
  normal: SHADER_STUDIO_FRAGMENT_CONTEXT.normal.glslType,
  cameraPosition: SHADER_STUDIO_FRAGMENT_CONTEXT.cameraPosition.glslType,
  frontFacing: SHADER_STUDIO_FRAGMENT_CONTEXT.frontFacing.glslType,
} as const;

/**
 * Indexed meshes with vertex buffers (plane, cube, sphere, model). Omitted
 * geometry is fullscreen for backwards-compatible compiler calls.
 */
export function isMeshGeometry(geometry?: GeometryType): boolean {
  return geometry !== undefined && geometry !== "fullscreen" && geometry !== "vertices";
}

/** Every geometry but fullscreen draws into a depth attachment. */
export function hasDepthAttachment(geometry?: GeometryType): boolean {
  return geometry !== undefined && geometry !== "fullscreen";
}
