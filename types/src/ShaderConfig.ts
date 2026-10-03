export interface BufferConfigInput {
    type: 'buffer';
    source: string;
    /** Layer of a multi-layer compute output to sample (default 0). */
    layer?: number;
    /** Colour attachment of a render buffer to sample (default 0). */
    output?: number;
    /** Sampling filter (default linear). */
    filter?: "linear" | "nearest";
    /** Addressing mode (default clamp). */
    wrap?: "repeat" | "clamp";
}

export interface TextureConfigInput {
    type: 'texture';
    path: string;
    resolved_path?: string;
    filter?: "linear" | "nearest" | "mipmap";
    wrap?: "repeat" | "clamp";
    vflip?: boolean;
    grayscale?: boolean;
}

export interface VideoConfigInput {
    type: 'video';
    path: string;
    resolved_path?: string;
    filter?: "linear" | "nearest" | "mipmap";
    wrap?: "repeat" | "clamp";
    vflip?: boolean;
    muted?: boolean;
}

export interface CubemapConfigInput {
    type: 'cubemap';
    path: string;
    resolved_path?: string;
    filter?: "linear" | "nearest" | "mipmap";
    wrap?: "repeat" | "clamp";
    vflip?: boolean;
}

export interface KeyboardConfigInput {
    type: 'keyboard';
}

export interface AudioConfigInput {
    type: 'audio';
    path: string;
    resolved_path?: string;
    startTime?: number;
    endTime?: number;
    muted?: boolean;
}

export type ConfigInput = BufferConfigInput | TextureConfigInput | VideoConfigInput | CubemapConfigInput | KeyboardConfigInput | AudioConfigInput;

export type AspectRatioMode = '16:9' | '4:3' | '1:1' | 'fill' | 'auto';
export type BufferOutputFormat = 'auto' | 'rgba16float' | 'rgba32float';

interface BaseImageResolutionSettings {
    scale?: number; // 0.25, 0.5, 1, 2, 4 (default: 1)
}

export interface AspectRatioResolutionSettings extends BaseImageResolutionSettings {
    aspectRatio?: AspectRatioMode; // default: 'fill'
    width?: never;
    height?: never;
}

export interface FixedImageResolutionSettings extends BaseImageResolutionSettings {
    width: number;
    height: number;
    aspectRatio?: never;
}

// Image pass resolution: either scale/aspect ratio, or fixed base dimensions plus optional scale.
export type ResolutionSettings = AspectRatioResolutionSettings | FixedImageResolutionSettings;

// Buffer pass resolution: fixed WxH OR scale multiplier on Image resolution
// Exactly one of (width+height) or scale should be set.
export type BufferResolution =
    | { width: number; height: number; scale?: never }
    | { scale: number; width?: never; height?: never };

export const GEOMETRY_TYPES = ["fullscreen", "vertices", "plane", "cube", "sphere", "model"] as const;
export type GeometryType = (typeof GEOMETRY_TYPES)[number];
/** Primitive topologies portable across WebGL and WebGPU for `vertices` draws. */
export const VERTEX_TOPOLOGIES = ["triangle-list", "triangle-strip", "line-list", "line-strip", "point-list"] as const;
export type VertexTopology = (typeof VERTEX_TOPOLOGIES)[number];
export const DEFAULT_VERTEX_TOPOLOGY: VertexTopology = "triangle-list";
/**
 * Views of indexed mesh geometry: the triangles, a wireframe of each unique
 * edge, or each unique vertex as a point. Strips do not apply to meshes.
 */
export const MESH_TOPOLOGIES = ["triangle-list", "line-list", "point-list"] as const satisfies readonly VertexTopology[];
export type MeshTopology = (typeof MESH_TOPOLOGIES)[number];
export const DEFAULT_MESH_TOPOLOGY: MeshTopology = "triangle-list";
/** Where `vertices` hooks place their positions: object space under the orbit camera, or final clip space. */
export const VERTEX_SPACES = ["world", "clip"] as const;
export type VertexSpace = (typeof VERTEX_SPACES)[number];
export const DEFAULT_VERTEX_SPACE: VertexSpace = "world";
export const DEFAULT_VERTEX_COUNT = 3;
/** WebGL's GLsizei maximum, the lower of the WebGL and WebGPU draw-count limits. */
export const MAX_VERTEX_COUNT = 2_147_483_647;
/** Copies of the geometry each draw makes; fullscreen always draws one. */
export const DEFAULT_INSTANCE_COUNT = 1;
/** WebGL's GLsizei maximum, like MAX_VERTEX_COUNT. */
export const MAX_INSTANCE_COUNT = 2_147_483_647;
/** Vertices a fullscreen pass draws: one oversized triangle. */
export const FULLSCREEN_VERTEX_COUNT = 3;
/** One oversized triangle covering every pixel. */
export interface FullscreenGeometryConfig {
  type: "fullscreen";
  instanceCount?: never;
}
/** A non-indexed draw with no vertex buffers whose positions come from the `mainVertex` hook. */
export interface VerticesGeometryConfig {
  type: "vertices";
  vertexCount?: number;
  topology?: VertexTopology;
  space?: VertexSpace;
  instanceCount?: number;
}
/** Indexed built-in meshes; their vertex count is fixed. */
export interface MeshGeometryConfig {
  type: Exclude<GeometryType, "fullscreen" | "vertices" | "model">;
  topology?: MeshTopology;
  instanceCount?: number;
}
export type BuiltinGeometryConfig = FullscreenGeometryConfig | VerticesGeometryConfig | MeshGeometryConfig;
/** A static GLB mesh. `resolved_path` is injected by the extension for webview loading. */
export interface ModelGeometryConfig {
  type: "model";
  path: string;
  mesh?: string;
  resolved_path?: string;
  topology?: MeshTopology;
  instanceCount?: number;
}
export type GeometryConfig = BuiltinGeometryConfig | ModelGeometryConfig;

export type WebGPUAuthoringMode = "hooks" | "native";

export interface ShaderEntryPoints {
  vertex?: string;
  fragment?: string;
  compute?: string;
}

/** Explicit names select native stages; omitted names keep the generated vertex or mainImage stage. */
export interface RenderEntryPoints {
  vertex?: string;
  fragment?: string;
}

export interface ComputeEntryPoints { compute?: string; }

/** How a render pass combines its output with what its own draw already wrote this frame. */
export const BLEND_MODES = ["none", "alpha", "premultiplied", "additive"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export const DEFAULT_BLEND_MODE: BlendMode = "none";

/** RGBA colour a render pass starts with each frame. Components are in [0, 1]. */
export type ClearColor = readonly [number, number, number, number];
export const DEFAULT_CLEAR_COLOR: ClearColor = [0, 0, 0, 1];

export const DEPTH_COMPARE_FUNCTIONS = ["never", "less", "equal", "less-equal", "greater", "not-equal", "greater-equal", "always"] as const;
export type DepthCompareFunction = (typeof DEPTH_COMPARE_FUNCTIONS)[number];
export const DEFAULT_DEPTH_COMPARE: DepthCompareFunction = "less";
/** Per-pass depth state. Not allowed on fullscreen geometry, which has no depth attachment. */
export interface DepthSettings {
  test?: boolean;
  write?: boolean;
  compare?: DepthCompareFunction;
}

/** Faces to discard; counter-clockwise triangles are front-facing. */
export const CULL_MODES = ["none", "back", "front"] as const;
export type CullMode = (typeof CULL_MODES)[number];
export const DEFAULT_CULL_MODE: CullMode = "none";

/**
 * Multisample antialiasing sample counts: 1 is off, 4 is the count both
 * WebGL2 and WebGPU guarantee for the formats a pass renders to.
 */
export const SAMPLE_COUNTS = [1, 4] as const;
export type SampleCount = (typeof SAMPLE_COUNTS)[number];
export const DEFAULT_SAMPLE_COUNT: SampleCount = 1;

/** Fixed-function state shared by Image and buffer passes, siblings of `geometry`. */
export interface RenderPassSettings {
  blend?: BlendMode;
  clear?: ClearColor;
  depth?: DepthSettings;
  cull?: CullMode;
  /** Antialias rasterised geometry; not for fullscreen geometry. */
  samples?: SampleCount;
}

export interface ImagePass extends RenderPassSettings {
  inputs?: Record<string, ConfigInput>;
  resolution?: ResolutionSettings;
  geometry?: GeometryConfig;
  /** WebGPU mesh viewer transforms; omitted means enabled. */
  useViewerCamera?: boolean;
  vertex?: string;
  entryPoints?: RenderEntryPoints;
}

export interface BufferPass extends RenderPassSettings {
  path: string;
  inputs?: Record<string, ConfigInput>;
  resolution?: BufferResolution;
  geometry?: GeometryConfig;
  /** WebGPU mesh viewer transforms; omitted means enabled. */
  useViewerCamera?: boolean;
  vertex?: string;
  entryPoints?: RenderEntryPoints;
  outputFormat?: BufferOutputFormat;
  /** Native WebGPU render outputs. Omitted keeps one colour output. */
  outputs?: { name?: string }[];
}

export interface CommonPass {
  path: string;
  inputs?: never;
  resolution?: never;
  geometry?: never;
  vertex?: never;
  blend?: never;
  clear?: never;
  depth?: never;
  cull?: never;
  entryPoints?: never;
}

/** Describes the layout of a named GPU storage buffer. Stride is always
 *  auto-inferred from the element type (built-in table or parsed struct). */
export interface StorageBufferConfig {
    count: number;
    elementType: string;
}

/** Exactly one compute dispatch mode: a 1D count, explicit dimensions, or a named output to cover. */
export type ComputeDispatch =
    | { count: number; x?: never; y?: never; z?: never; cover?: never }
    | { x: number; y: number; z: number; count?: never; cover?: never }
    | { cover: string; count?: never; x?: never; y?: never; z?: never };

/** A WebGPU compute pass with optional inputs, output dimensions, and dispatch configuration. */
export interface ComputePass {
    /** Identifies this pass as a compute pass, independent of its name. */
    type: "compute";
    path: string;
    inputs?: Record<string, ConfigInput>;
    resolution?: BufferResolution;
    outputLayers?: number;
    outputFormat?: BufferOutputFormat;
    dispatch?: ComputeDispatch;
    dispatchCount?: number;
    dispatchOnce?: boolean;
    /** Legacy compute selection; new configs use entryPoints.compute. */
    entryPoint?: string;
    geometry?: never;
    vertex?: never;
    blend?: never;
    clear?: never;
    depth?: never;
    cull?: never;
    entryPoints?: ComputeEntryPoints;
}

export interface ShaderPasses {
    Image: ImagePass;
    BufferA?: BufferPass;
    BufferB?: BufferPass;
    BufferC?: BufferPass;
    BufferD?: BufferPass;
  common?: CommonPass;
  [name: string]: BufferPass | ImagePass | ComputePass | CommonPass | undefined;
}

export interface ShaderConfig {
    version: string;
    script?: string;
    scriptMaxPollingFps?: number;
    storage?: Record<string, StorageBufferConfig>;
    /** Project preference for new render templates; existing pass execution is unchanged. */
    webgpu?: { defaultRenderAuthoring?: WebGPUAuthoringMode };
    passes: ShaderPasses;
}
