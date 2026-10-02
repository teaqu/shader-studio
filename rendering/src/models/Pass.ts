import type { BufferOutputFormat, BufferResolution, GeometryType } from "@shader-studio/types";
import type { FullscreenDrawConfig } from "../types/Geometry";

export type Pass = FullscreenDrawConfig & {
  name: string;
  shaderSrc: string;
  vertexSrc?: string;
  inputs: Record<string, any>;
  geometry: GeometryType;
  modelPath?: string;
  modelMesh?: string;
  path?: string;
  resolution?: BufferResolution;
  outputFormat?: BufferOutputFormat;
}
