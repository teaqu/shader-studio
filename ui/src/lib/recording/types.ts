import type { ShaderConfig, ShaderLanguageId, SlangSourceModule } from "@shader-studio/types";

export interface ScreenshotConfig {
  mode?: "live" | "render";
  format: "png" | "jpeg";
  time?: number;
  width: number;
  height: number;
}

export interface RecordingConfig {
  mode?: "live" | "render";
  format: "webm" | "mp4" | "gif";
  duration: number;
  startTime: number;
  fps: number;
  width: number;
  height: number;
  loopCount?: number;
  quality?: number;
}

export interface ShaderInfo {
  code: string;
  config: ShaderConfig | null;
  path: string;
  buffers: Record<string, string>;
  language?: ShaderLanguageId;
  customUniformDeclarations?: string;
  customUniformInfo?: { name: string; type: string }[];
  customUniformValues?: CaptureUniformValue[];
  slangModules?: SlangSourceModule[];
  slangSourcePath?: string;
  slangSourcePaths?: Record<string, string>;
}

export interface CaptureUniformValue {
  name: string;
  type: string;
  value: number | number[] | boolean;
}

/** A detached copy of every mutable input used by a Render capture. */
export interface RenderCaptureSnapshot {
  readonly code: string;
  readonly config: ShaderConfig | null;
  readonly path: string;
  readonly buffers: Record<string, string>;
  readonly language?: ShaderLanguageId;
  readonly customUniformDeclarations?: string;
  readonly customUniformInfo: { name: string; type: string }[];
  readonly customUniformValues: CaptureUniformValue[];
  readonly slangModules?: SlangSourceModule[];
  readonly slangSourcePath?: string;
  readonly slangSourcePaths?: Record<string, string>;
}

function cloneCaptureData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneCaptureData(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneCaptureData(item)]),
    ) as T;
  }
  return value;
}

export function createRenderCaptureSnapshot(shaderInfo: ShaderInfo): RenderCaptureSnapshot {
  return {
    code: shaderInfo.code,
    config: shaderInfo.config === null ? null : cloneCaptureData(shaderInfo.config),
    path: shaderInfo.path,
    buffers: cloneCaptureData(shaderInfo.buffers),
    language: shaderInfo.language,
    customUniformDeclarations: shaderInfo.customUniformDeclarations,
    customUniformInfo: cloneCaptureData(shaderInfo.customUniformInfo ?? []),
    customUniformValues: cloneCaptureData(shaderInfo.customUniformValues ?? []),
    slangModules: shaderInfo.slangModules === undefined
      ? undefined
      : cloneCaptureData(shaderInfo.slangModules),
    slangSourcePath: shaderInfo.slangSourcePath,
    slangSourcePaths: shaderInfo.slangSourcePaths === undefined
      ? undefined
      : cloneCaptureData(shaderInfo.slangSourcePaths),
  };
}

export type OnScreenshot = (config: ScreenshotConfig) => void;
export type OnRecord = (config: RecordingConfig) => void;
