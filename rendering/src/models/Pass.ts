import type { BufferOutputFormat, BufferResolution, GeometryType, RenderPassSettings } from "@shader-studio/types";
import type { VerticesDrawConfig } from "../types/Geometry";

export type Pass = VerticesDrawConfig & RenderPassSettings & {
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
  /** Set when a blended buffer falls back from rgba32float to rgba16float. */
  outputFormatWarning?: string;
}
