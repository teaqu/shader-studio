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

export interface CubemapConfigInput {
    type: 'cubemap';
    source: 'CubeA';
    filter?: "linear" | "nearest" | "mipmap";
}

export interface VolumeConfigInput {
    type: 'volume';
    path: string;
    resolved_path?: string;
    filter?: "linear" | "nearest" | "mipmap";
    wrap?: "repeat" | "clamp";
}

export type ConfigInput = BufferConfigInput | TextureConfigInput | VideoConfigInput | KeyboardConfigInput | AudioConfigInput | CubemapConfigInput | VolumeConfigInput;

export interface ImagePass {
    inputs?: Record<string, ConfigInput>;
}

export interface BufferPass {
    path: string;
    inputs?: Record<string, ConfigInput>;
}

export interface ShaderPasses {
    Image: ImagePass;
    BufferA?: BufferPass;
    BufferB?: BufferPass;
    BufferC?: BufferPass;
    BufferD?: BufferPass;
    CubeA?: BufferPass;
    common?: BufferPass;
    [name: string]: BufferPass | ImagePass | undefined;
}

export interface ShaderConfig {
    version: string;
    passes: ShaderPasses;
}
