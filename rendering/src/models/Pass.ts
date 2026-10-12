import type { BufferOutputFormat, BufferResolution, ConfigInput, GeometryType, RenderPassSettings } from "@shader-studio/types";
import type { InstanceDrawConfig, VerticesDrawConfig } from "../types/Geometry";

export type Pass = VerticesDrawConfig & InstanceDrawConfig & RenderPassSettings & {
  name: string;
  shaderSrc: string;
  vertexSrc?: string;
  useViewerCamera?: boolean;
  inputs: Record<string, ConfigInput>;
  geometry: GeometryType;
  modelPath?: string;
  modelMesh?: string;
  path?: string;
  resolution?: BufferResolution;
  outputFormat?: BufferOutputFormat;
  outputKind?: "2d" | "cubemap";
  faceSize?: number;
  /** Channels referencing cubemap outputs, inferred from the project graph. */
  cubemapSources?: string[];
  /** Set when a blended buffer falls back from rgba32float to rgba16float. */
  outputFormatWarning?: string;
}
