export interface BufferConfigInput {
    type: 'buffer';
    source: string;
    /** Layer of a multi-layer compute output to sample (default 0). */
    layer?: number;
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

export const GEOMETRY_TYPES = ["fullscreen", "plane", "cube", "sphere", "model"] as const;
export type GeometryType = (typeof GEOMETRY_TYPES)[number];
/** Primitive topologies portable across WebGL and WebGPU for fullscreen draws. */
export const VERTEX_TOPOLOGIES = ["triangle-list", "triangle-strip", "line-list", "line-strip", "point-list"] as const;
export type VertexTopology = (typeof VERTEX_TOPOLOGIES)[number];
export const DEFAULT_VERTEX_TOPOLOGY: VertexTopology = "triangle-list";
export const DEFAULT_FULLSCREEN_VERTEX_COUNT = 3;
/** WebGL's GLsizei maximum, the lower of the WebGL and WebGPU draw-count limits. */
export const MAX_FULLSCREEN_VERTEX_COUNT = 2_147_483_647;
/** A non-indexed draw whose vertex positions come from the `mainVertex` hook. */
export interface FullscreenGeometryConfig {
  type: "fullscreen";
  vertexCount?: number;
  topology?: VertexTopology;
}
/** Indexed built-in meshes; their vertex count and topology are fixed. */
export interface MeshGeometryConfig {
  type: Exclude<GeometryType, "fullscreen" | "model">;
  vertexCount?: never;
  topology?: never;
}
export type BuiltinGeometryConfig = FullscreenGeometryConfig | MeshGeometryConfig;
/** A static GLB mesh. `resolved_path` is injected by the extension for webview loading. */
export interface ModelGeometryConfig {
  type: "model";
  path: string;
  mesh?: string;
  resolved_path?: string;
  vertexCount?: never;
  topology?: never;
}
export type GeometryConfig = BuiltinGeometryConfig | ModelGeometryConfig;

export interface ImagePass {
  inputs?: Record<string, ConfigInput>;
  resolution?: ResolutionSettings;
  geometry?: GeometryConfig;
  vertex?: string;
}

export interface BufferPass {
  path: string;
  inputs?: Record<string, ConfigInput>;
  resolution?: BufferResolution;
  geometry?: GeometryConfig;
  vertex?: string;
  outputFormat?: BufferOutputFormat;
}

export interface CommonPass {
  path: string;
  inputs?: never;
  resolution?: never;
  geometry?: never;
  vertex?: never;
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

/** A Slang compute pass with optional inputs, output dimensions, and dispatch configuration. */
export interface ComputePass {
    /** Identifies this pass as a Slang compute pass, independent of its name. */
    type: "compute";
    path: string;
    inputs?: Record<string, ConfigInput>;
    resolution?: BufferResolution;
    outputLayers?: number;
    outputFormat?: BufferOutputFormat;
    dispatch?: ComputeDispatch;
    dispatchCount?: number;
    dispatchOnce?: boolean;
    /** Named native `[shader("compute")]` entrypoint in this pass source. */
    entryPoint?: string;
    geometry?: never;
    vertex?: never;
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
    passes: ShaderPasses;
}
