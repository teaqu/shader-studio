export interface BufferConfigInput {
    type: 'buffer';
    source: string;
    /** Layer of a multi-layer compute output to sample (default 0). */
    layer?: number;
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

export interface ImagePass {
    inputs?: Record<string, ConfigInput>;
    resolution?: ResolutionSettings;
}

export interface BufferPass {
    path: string;
    inputs?: Record<string, ConfigInput>;
    resolution?: BufferResolution;
}

/** Describes the layout of a named GPU storage buffer. */
export interface StorageBufferConfig {
    count: number;
    stride: number;
    elementType: string;
}

/** Exactly one compute dispatch mode: a 1D count, explicit dimensions, or a named output to cover. */
export type ComputeDispatch =
    | { count: number; x?: never; y?: never; z?: never; cover?: never }
    | { x: number; y: number; z: number; count?: never; cover?: never }
    | { cover: string; count?: never; x?: never; y?: never; z?: never };

/** A Slang compute pass with optional inputs, output dimensions, and dispatch configuration. */
export interface ComputePass {
    path: string;
    inputs?: Record<string, ConfigInput>;
    resolution?: BufferResolution;
    outputLayers?: number;
    dispatch?: ComputeDispatch;
    dispatchCount?: number;
    dispatchOnce?: boolean;
    workgroupSize?: [number, number, number];
}

export interface ShaderPasses {
    Image: ImagePass;
    BufferA?: BufferPass;
    BufferB?: BufferPass;
    BufferC?: BufferPass;
    BufferD?: BufferPass;
    common?: BufferPass;
    [name: string]: BufferPass | ImagePass | ComputePass | undefined;
}

export interface ShaderConfig {
    version: string;
    script?: string;
    scriptMaxPollingFps?: number;
    storage?: Record<string, StorageBufferConfig>;
    passes: ShaderPasses;
}
