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

export type ConfigInput = BufferConfigInput | TextureConfigInput | VideoConfigInput | CubemapConfigInput | KeyboardConfigInput;

export interface ImagePass {
    inputs?: Record<string, ConfigInput>;
}

export interface BufferPass {
    path: string;
    inputs?: Record<string, ConfigInput>;
}

export interface ShaderPasses {
    Image: ImagePass;
    common?: BufferPass;
    [name: string]: BufferPass | ImagePass | undefined;
}

export interface ShaderConfig {
    version: string;
    passes: ShaderPasses;
}
