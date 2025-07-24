export interface ConfigInput {
  type: 'buffer' | 'texture' | 'keyboard';
  source?: 'BufferA' | 'BufferB' | 'BufferC' | 'BufferD';
  path?: string;
}

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
