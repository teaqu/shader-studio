import {
  DEFAULT_BLEND_MODE,
  DEFAULT_CLEAR_COLOR,
  DEFAULT_CULL_MODE,
  DEFAULT_DEPTH_COMPARE,
  DEFAULT_INSTANCE_COUNT,
  DEFAULT_MESH_TOPOLOGY,
  DEFAULT_VERTEX_COUNT,
  DEFAULT_VERTEX_SPACE,
  DEFAULT_VERTEX_TOPOLOGY,
  type BlendMode,
  type ClearColor,
  type CullMode,
  type DepthCompareFunction,
  type DepthSettings,
  type GeometryType,
  type MeshTopology,
  type RenderPassSettings,
  type VertexSpace,
  type VertexTopology,
} from "@shader-studio/types";

export const DEFAULT_GEOMETRY: GeometryType = "fullscreen";

export function resolvePassGeometry(
  pass: { geometry?: { type: GeometryType } } | undefined,
): GeometryType {
  return pass?.geometry?.type ?? DEFAULT_GEOMETRY;
}

/**
 * Configured `vertices` draw fields. Each is present only when the config
 * sets it, and only for vertices geometry.
 */
export interface VerticesDrawConfig {
  vertexCount?: number;
  topology?: VertexTopology;
  space?: VertexSpace;
}

export interface InstanceDrawConfig {
  instanceCount?: number;
}

export function resolveInstanceDraw(pass: { geometry?: { type: GeometryType; instanceCount?: number } } | undefined): InstanceDrawConfig {
  const geometry = pass?.geometry;
  return geometry && geometry.type !== "fullscreen" && geometry.instanceCount !== undefined
    ? { instanceCount: geometry.instanceCount }
    : {};
}

export function geometryInstanceCount(draw: InstanceDrawConfig): number {
  return draw.instanceCount ?? DEFAULT_INSTANCE_COUNT;
}

type VerticesGeometryLike = { type: GeometryType; vertexCount?: number; topology?: VertexTopology; space?: VertexSpace };

export function resolveVerticesDraw(pass: { geometry?: VerticesGeometryLike } | undefined): VerticesDrawConfig {
  const geometry = pass?.geometry;
  if (geometry?.type !== "vertices") {
    return {};
  }
  return {
    ...(geometry.vertexCount !== undefined ? { vertexCount: geometry.vertexCount } : {}),
    ...(geometry.topology !== undefined ? { topology: geometry.topology } : {}),
    ...(geometry.space !== undefined ? { space: geometry.space } : {}),
  };
}

/**
 * The configured topology of plane, cube, sphere and model geometry, carried
 * on the pass's shared `topology` field. Vertices geometry resolves its own.
 */
export function resolveMeshTopology(pass: { geometry?: { type: GeometryType; topology?: VertexTopology } } | undefined): Pick<VerticesDrawConfig, "topology"> {
  const geometry = pass?.geometry;
  return geometry && geometry.type !== "fullscreen" && geometry.type !== "vertices" && geometry.topology !== undefined
    ? { topology: geometry.topology }
    : {};
}

/** Mesh topology with its default; only the mesh topologies reach a mesh pass. */
export function meshTopology(draw: Pick<VerticesDrawConfig, "topology">): MeshTopology {
  return (draw.topology ?? DEFAULT_MESH_TOPOLOGY) as MeshTopology;
}

export function verticesVertexCount(draw: VerticesDrawConfig): number {
  return draw.vertexCount ?? DEFAULT_VERTEX_COUNT;
}

export function verticesTopology(draw: VerticesDrawConfig): VertexTopology {
  return draw.topology ?? DEFAULT_VERTEX_TOPOLOGY;
}

export function verticesSpace(draw: VerticesDrawConfig): VertexSpace {
  return draw.space ?? DEFAULT_VERTEX_SPACE;
}

/** True for vertices geometry drawn straight into clip space, without the camera. */
export function isClipSpaceVertices(pass: VerticesDrawConfig & { geometry?: GeometryType }): boolean {
  return pass.geometry === "vertices" && verticesSpace(pass) === "clip";
}

/** Copies the configured blend/clear/depth/cull of a render pass; absent fields stay absent. */
export function resolvePassRenderSettings(pass: RenderPassSettings | undefined): RenderPassSettings {
  return {
    ...(pass?.blend !== undefined ? { blend: pass.blend } : {}),
    ...(pass?.clear !== undefined ? { clear: [...pass.clear] as ClearColor } : {}),
    ...(pass?.depth !== undefined ? { depth: { ...pass.depth } } : {}),
    ...(pass?.cull !== undefined ? { cull: pass.cull } : {}),
  };
}

export interface ResolvedDepthState {
  test: boolean;
  write: boolean;
  compare: DepthCompareFunction;
}

/** Fixed-function state a render pass draws with, defaults applied. */
export interface ResolvedRenderState {
  blend: BlendMode;
  clear: ClearColor;
  /** Null for fullscreen geometry, which has no depth attachment. */
  depth: ResolvedDepthState | null;
  cull: CullMode;
}

/**
 * Resolve blend/depth/cull for a pass. Meshes and world-space vertices
 * depth-test and write with `less` when omitted; clip-space vertices draw in
 * submission order unless the config turns the test on.
 */
export function resolveRenderState(
  pass: VerticesDrawConfig & RenderPassSettings & { geometry?: GeometryType },
): ResolvedRenderState {
  const geometry = pass.geometry ?? DEFAULT_GEOMETRY;
  const blend = pass.blend ?? DEFAULT_BLEND_MODE;
  const clear = pass.clear ?? DEFAULT_CLEAR_COLOR;
  if (geometry === "fullscreen") {
    return { blend, clear, depth: null, cull: "none" };
  }
  const depth: DepthSettings = pass.depth ?? {};
  return {
    blend,
    clear,
    depth: {
      test: depth.test ?? !isClipSpaceVertices({ ...pass, geometry }),
      write: depth.write ?? true,
      compare: depth.compare ?? DEFAULT_DEPTH_COMPARE,
    },
    cull: pass.cull ?? DEFAULT_CULL_MODE,
  };
}

/**
 * Depth the attachment is cleared to before a pass draws. A greater compare
 * would never pass against the usual far value of 1, so it starts from 0.
 */
export function depthClearValue(state: ResolvedRenderState): number {
  const compare = state.depth?.test ? state.depth.compare : undefined;
  return compare === "greater" || compare === "greater-equal" ? 0 : 1;
}

/**
 * Stable key for the vertices draw and render state a WebGPU render pipeline
 * bakes in. vertexCount is a draw argument, so it is left out.
 */
export function renderPipelineStateKey(
  pass: VerticesDrawConfig & RenderPassSettings & { geometry?: GeometryType },
): string {
  const state = resolveRenderState(pass);
  const vertices = pass.geometry === "vertices"
    ? `${verticesTopology(pass)}/${verticesSpace(pass)}`
    : pass.geometry && pass.geometry !== "fullscreen" ? meshTopology(pass) : "";
  const depth = state.depth ? `${state.depth.test}/${state.depth.write}/${state.depth.compare}` : "";
  return [vertices, state.blend, depth, state.cull].join("|");
}
