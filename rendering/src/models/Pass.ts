import type { BufferOutputFormat, BufferResolution, GeometryType, RenderPassSettings } from "@shader-studio/types";
import type { InstanceDrawConfig, VerticesDrawConfig } from "../types/Geometry";

export type Pass = VerticesDrawConfig & InstanceDrawConfig & RenderPassSettings & {
  name: string;
  shaderSrc: string;
  vertexSrc?: string;
  useViewerCamera?: boolean;
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
