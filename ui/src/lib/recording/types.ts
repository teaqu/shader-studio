import type { ShaderConfig, SlangWorkspaceSnapshot } from "@shader-studio/types";

export interface ScreenshotConfig {
  format: "png" | "jpeg";
  time?: number;
  width: number;
  height: number;
}

export interface RecordingConfig {
  format: "webm" | "mp4" | "gif";
  duration: number;
  startTime: number;
  fps: number;
  width: number;
  height: number;
  maxColors?: number;
  loopCount?: number;
  quality?: number;
}

export interface ShaderInfo {
  code: string;
  config: ShaderConfig | null;
  path: string;
  buffers: Record<string, string>;
  language?: "glsl" | "slang";
  workspace?: SlangWorkspaceSnapshot;
}

export type OnScreenshot = (config: ScreenshotConfig) => void;
export type OnRecord = (config: RecordingConfig) => void;
