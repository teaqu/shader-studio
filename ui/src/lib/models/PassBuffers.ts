import type { PiRenderTarget } from "../types/piRenderer";

export interface PassBuffers {
  [passName: string]: {
    front: PiRenderTarget | null;
    back: PiRenderTarget | null;
  };
}
