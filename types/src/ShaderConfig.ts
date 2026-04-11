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

// Image pass resolution: scale + aspect ratio + optional custom override
export interface ResolutionSettings {
    scale?: number;              // 0.25, 0.5, 1, 2, 4 (default: 1)
    aspectRatio?: AspectRatioMode; // default: 'fill'
    customWidth?: number | string;  // px number or "50%" string (overrides scale/aspect)
    customHeight?: number | string; // must be set with customWidth
}

// Buffer pass resolution: fixed WxH OR scale multiplier on Image resolution
// Exactly one of (width+height) or scale should be set.
export interface BufferResolution {
    width?: number;
    height?: number;
    scale?: number;  // multiplier on Image resolution (0.25, 0.5, 1, 2, 4)
}

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
