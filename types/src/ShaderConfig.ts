export interface BufferConfigInput {
    type: 'buffer';
    source: 'BufferA' | 'BufferB' | 'BufferC' | 'BufferD';
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

export type ConfigInput = BufferConfigInput | TextureConfigInput | VideoConfigInput | KeyboardConfigInput;

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
    common?: BufferPass;
}

export interface ShaderConfig {
    version: string;
    passes: ShaderPasses;
}
