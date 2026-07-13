import type { BufferResolution } from "@shader-studio/types";

export type Pass = {
  name: string;
  shaderSrc: string;
  inputs: Record<string, any>;
  path?: string;
  resolution?: BufferResolution;
}
