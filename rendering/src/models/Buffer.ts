import type { PiRenderTarget } from "../../ui/src/lib/types/piRenderer";

export interface Buffer {
  front: PiRenderTarget | null;
  back: PiRenderTarget | null;
}

export interface Buffers {
  [name: string]: Buffer;
}
