import type { BufferResolution, GeometryType } from "@shader-studio/types";

export type Pass = {
  name: string;
  shaderSrc: string;
  inputs: Record<string, any>;
  geometry: GeometryType;
  path?: string;
  resolution?: BufferResolution;
}
