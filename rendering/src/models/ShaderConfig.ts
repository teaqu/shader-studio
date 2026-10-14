export interface BufferConfigInput {
  type: 'buffer';
  source: string;
  layer?: number;
  filter?: "linear" | "nearest";
  wrap?: "repeat" | "clamp";
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

export interface VolumeConfigInput {
    type: 'volume';
    path: string;
    resolved_path?: string;
    filter?: "linear" | "nearest";
    /** Applies to X, Y, and Z. */
    wrap?: "repeat" | "clamp";
}

export interface VideoConfigInput {
  type: 'video';
  path: string;
  filter?: "linear" | "nearest" | "mipmap";
  wrap?: "repeat" | "clamp";
  vflip?: boolean;
  muted?: boolean;
}

export type ConfigInput = BufferConfigInput | TextureConfigInput | VolumeConfigInput | KeyboardConfigInput | VideoConfigInput | CubemapConfigInput;
