import type { BufferOutputFormat, BufferResolution, ConfigInput, GeometryType } from "@shader-studio/types";

export type Pass = {
  name: string;
  shaderSrc: string;
  vertexSrc?: string;
  inputs: Record<string, ConfigInput>;
  geometry: GeometryType;
  modelPath?: string;
  modelMesh?: string;
  path?: string;
  resolution?: BufferResolution;
  outputFormat?: BufferOutputFormat;
}
