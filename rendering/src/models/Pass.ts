import type { BufferResolution, GeometryType } from "@shader-studio/types";

export type Pass = {
  name: string;
  shaderSrc: string;
  vertexSrc?: string;
  inputs: Record<string, any>;
  geometry: GeometryType;
  modelPath?: string;
  modelMesh?: string;
  path?: string;
  resolution?: BufferResolution;
}
