export interface BufferConfigInput {
    type: 'buffer';
    source: 'BufferA' | 'BufferB' | 'BufferC' | 'BufferD';
}

export interface TextureConfigInput {
    type: 'texture';
    path: string;
}

export interface KeyboardConfigInput {
    type: 'keyboard';
}

export type ConfigInput = BufferConfigInput | TextureConfigInput | KeyboardConfigInput;

export interface ImagePass {
    inputs?: Partial<Record<`iChannel${0 | 1 | 2 | 3}`, ConfigInput>>;
}

export interface BufferPass {
    path: string;
    inputs?: Partial<Record<`iChannel${0 | 1 | 2 | 3}`, ConfigInput>>;
}

export interface ShaderConfig {
    version: string;
    Image: ImagePass;
    BufferA?: BufferPass;
    BufferB?: BufferPass;
    BufferC?: BufferPass;
    BufferD?: BufferPass;
}
