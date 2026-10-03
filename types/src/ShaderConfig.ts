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

export const GEOMETRY_TYPES = ["fullscreen", "plane", "cube", "sphere", "model"] as const;
export type GeometryType = (typeof GEOMETRY_TYPES)[number];
export interface BuiltinGeometryConfig { type: Exclude<GeometryType, "model">; }
/** A static GLB mesh. `resolved_path` is injected by the extension for webview loading. */
export interface ModelGeometryConfig {
  type: "model";
  path: string;
  mesh?: string;
  resolved_path?: string;
}
export type GeometryConfig = BuiltinGeometryConfig | ModelGeometryConfig;

export type WebGPUAuthoringMode = "hooks" | "native";

export interface ShaderEntryPoints {
  vertex?: string;
  fragment?: string;
  compute?: string;
}

/** Presence opts a render pass into native stages; omitted names resolve only when unambiguous. */
export interface RenderEntryPoints {
  vertex?: string;
  fragment?: string;
}

export interface ComputeEntryPoints { compute?: string; }

export interface ImagePass {
  inputs?: Record<string, ConfigInput>;
  resolution?: ResolutionSettings;
  geometry?: GeometryConfig;
  vertex?: string;
  entryPoints?: RenderEntryPoints;
}

export interface BufferPass {
  path: string;
  inputs?: Record<string, ConfigInput>;
  resolution?: BufferResolution;
  geometry?: GeometryConfig;
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
