import type {
  AudioConfigInput,
  CubemapConfigInput,
  GeometryType,
  ShaderLanguageId,
  TextureConfigInput,
  VideoConfigInput,
  BufferOutputFormat,
} from "@shader-studio/types";

export type RenderPassName = string;
export type ChannelReadTiming = "previous-frame" | "current-frame";

export type RenderPassChannel =
  | {
      kind: "buffer";
      slot: number;
      key: string;
      source: string;
      readFrom: ChannelReadTiming;
      layer?: number;
      filter?: "linear" | "nearest";
      wrap?: "repeat" | "clamp";
      effectiveFilter?: "linear" | "nearest";
      samplingFallbackReason?: string;
      sampleType?: "float" | "unfilterable-float";
      samplerType?: "filtering" | "non-filtering";
    }
  | {
      kind: "texture"; slot: number; key: string; path: string;
      filter?: TextureConfigInput["filter"]; wrap?: TextureConfigInput["wrap"];
      vflip?: boolean; grayscale?: boolean;
    }
  | {
      kind: "video"; slot: number; key: string; path: string;
      filter?: VideoConfigInput["filter"]; wrap?: VideoConfigInput["wrap"];
      vflip?: boolean; muted?: boolean;
    }
  | {
      kind: "cubemap"; slot: number; key: string; path: string;
      filter?: CubemapConfigInput["filter"]; wrap?: CubemapConfigInput["wrap"];
      vflip?: boolean;
    }
  | {
      kind: "audio"; slot: number; key: string; path: string;
      muted?: AudioConfigInput["muted"];
      startTime?: AudioConfigInput["startTime"];
      endTime?: AudioConfigInput["endTime"];
    }
  | { kind: "keyboard"; slot: number; key: string };

export interface StorageBindingNode {
  name: string;
  /** Zero-based index among the graph's valid storage declarations. */
  binding: number;
  elementType: string;
  /** True when elementType is on the built-in whitelist (declared before common). */
  builtin: boolean;
  /** True when WGSL requires a read-write binding because the element contains an atomic. */
  containsAtomic?: boolean;
  count: number;
  stride: number;
}

export type DispatchSpec =
  | { mode: "texel" }
  | { mode: "count"; count: number }
  | { mode: "workgroups"; x: number; y: number; z: number }
  | { mode: "cover-storage"; name: string }
  | { mode: "cover-channel"; key: string };

export interface RenderPassNode {
  name: RenderPassName;
  source: string;
  vertexSrc?: string;
  /** Shader language of the pass source; selected by the graph-level option. */
  language: ShaderLanguageId;
  geometry: GeometryType;
  /** Webview-accessible GLB URL when geometry is `model`. */
  modelPath?: string;
  modelMesh?: string;
  path?: string;
  kind: "render" | "compute";
  output: "texture" | "canvas" | "none";
  outputLayers: number;
  outputFormat?: BufferOutputFormat;
  resolvedOutputFormat?: "rgba16float" | "rgba32float";
  dispatch?: DispatchSpec;
  dispatchCount: number;
  dispatchOnce: boolean;
  workgroupSize: [number, number, number];
  entryPoint?: string;
  width: number;
  height: number;
  channels: RenderPassChannel[];
}

export interface RenderPassGraph {
  passes: RenderPassNode[];
  storage: StorageBindingNode[];
  commonCode: string;
  warnings: string[];
  errors: string[];
}
