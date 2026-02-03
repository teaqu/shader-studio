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
  grayscale?: boolean;
}

export interface KeyboardConfigInput {
  type: 'keyboard';
}

export interface VideoConfigInput {
  type: 'video';
  path: string;
  filter?: "linear" | "nearest" | "mipmap";
  wrap?: "repeat" | "clamp";
  vflip?: boolean;
}

export type ConfigInput = BufferConfigInput | TextureConfigInput | KeyboardConfigInput | VideoConfigInput;

export interface ConfigPass {
  path?: string;
  inputs?: Record<`iChannel${0 | 1 | 2 | 3}`, ConfigInput>;
}

export interface ShaderConfig {
  version: string;
  Image: ConfigPass;
  BufferA?: ConfigPass;
  BufferB?: ConfigPass;
  BufferC?: ConfigPass;
  BufferD?: ConfigPass;
}
