export interface BufferConfigInput {
  type: 'buffer';
  source: string;
}

export interface TextureConfigInput {
  type: 'texture';
  path: string;
  filter?: "linear" | "nearest" | "mipmap";
  wrap?: "repeat" | "clamp";
  vflip?: boolean;
  grayscale?: boolean;
}

export interface CubemapConfigInput {
  type: 'cubemap';
  path: string;
  filter?: "linear" | "nearest" | "mipmap";
  wrap?: "repeat" | "clamp";
  vflip?: boolean;
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

export type ConfigInput = BufferConfigInput | TextureConfigInput | KeyboardConfigInput | VideoConfigInput | CubemapConfigInput;

