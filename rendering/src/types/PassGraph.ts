import type { CubemapConfigInput, TextureConfigInput, VideoConfigInput } from "@shader-studio/types";

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
  | { kind: "keyboard"; slot: number; key: string };

export interface StorageBindingNode {
  name: string;
  /** Zero-based index among the graph's valid storage declarations. */
  binding: number;
  elementType: string;
  /** True when elementType is on the built-in whitelist (declared before common). */
  builtin: boolean;
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
  path?: string;
  kind: "render" | "compute";
  output: "texture" | "canvas" | "none";
  outputLayers: number;
  dispatch?: DispatchSpec;
  dispatchCount: number;
  dispatchOnce: boolean;
  workgroupSize: [number, number, number];
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
