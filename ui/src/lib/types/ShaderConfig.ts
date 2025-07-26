export interface BufferConfigInput {
    type: 'buffer';
    source: 'BufferA' | 'BufferB' | 'BufferC' | 'BufferD';
}

export interface TextureConfigInput {
    type: 'texture';
    path: string;
    filter?: "linear" | "nearest" | "mipmap";
    wrap?: "repeat" | "clamp";
    vflip?: boolean;
}

export interface KeyboardConfigInput {
    type: 'keyboard';
}

export type ConfigInput = BufferConfigInput | TextureConfigInput | KeyboardConfigInput;

export interface ConfigPass {
    path?: string;
    inputs?: Partial<Record<`iChannel${0 | 1 | 2 | 3}`, ConfigInput>>;
}

export interface ShaderPasses {
    Image: ConfigPass;
    BufferA?: ConfigPass;
    BufferB?: ConfigPass;
    BufferC?: ConfigPass;
    BufferD?: ConfigPass;
}

export interface ShaderConfig {
    version: string;
    passes: ShaderPasses;
}
