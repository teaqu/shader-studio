export type RenderPassName = "BufferA" | "BufferB" | "BufferC" | "BufferD" | "Image";
export type ChannelReadTiming = "previous-frame" | "current-frame";

export interface RenderPassChannel {
  slot: number;
  key: string;
  source: string;
  readFrom: ChannelReadTiming;
}

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
