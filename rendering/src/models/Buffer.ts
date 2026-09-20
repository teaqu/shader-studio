import type { PiRenderTarget } from "../types/piRenderer";

export interface Buffer {
  outputFormat?: "rgba16float" | "rgba32float";
  front: PiRenderTarget | null;
  back: PiRenderTarget | null;
  requiresDepth: boolean;
}

export interface Buffers {
  [name: string]: Buffer;
}
