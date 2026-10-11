import type { PiRenderTarget } from "../types/piRenderer";

export interface Buffer {
  outputKind?: "2d" | "cubemap";
  outputFormat?: "rgba16float" | "rgba32float";
  front: PiRenderTarget | null;
  back: PiRenderTarget | null;
  requiresDepth: boolean;
}

export interface Buffers {
  [name: string]: Buffer;
}
