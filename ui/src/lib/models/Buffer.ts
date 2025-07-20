import type { PiRenderTarget } from "../types/piRenderer";

export interface Buffer {
  front: PiRenderTarget | null;
  back: PiRenderTarget | null;
}

export interface Buffers {
  [name: string]: Buffer;
}
