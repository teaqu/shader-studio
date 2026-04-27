export interface BufferConfigInput {
    type: 'buffer';
    source: string;
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

export interface ShaderPasses {
    Image: ImagePass;
    BufferA?: BufferPass;
    BufferB?: BufferPass;
    BufferC?: BufferPass;
    BufferD?: BufferPass;
    common?: BufferPass;
    [name: string]: BufferPass | ImagePass | undefined;
}

export interface ShaderConfig {
    version: string;
    script?: string;
    scriptMaxPollingFps?: number;
    passes: ShaderPasses;
}
