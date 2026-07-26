import type {
  AudioConfigInput,
  CubemapConfigInput,
  TextureConfigInput,
  VideoConfigInput,
} from "@shader-studio/types";

export type RenderPassName = string;
export type ChannelReadTiming = "previous-frame" | "current-frame";

export type RenderPassChannel =
  | { kind: "buffer"; slot: number; key: string; source: string; readFrom: ChannelReadTiming }
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

export interface RenderPassNode {
  name: RenderPassName;
  source: string;
  path?: string;
  output: "texture" | "canvas";
  width: number;
  height: number;
  channels: RenderPassChannel[];
}

export interface RenderPassGraph {
  passes: RenderPassNode[];
  commonCode: string;
  warnings: string[];
  errors: string[];
}
