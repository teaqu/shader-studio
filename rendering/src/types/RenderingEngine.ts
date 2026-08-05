import type { DebugInstrumentationPlan, ShaderConfig, SlangSourceModule, StorageBufferSnapshot } from "@shader-studio/types";
import type { CompilationResult } from "../models";
import type { TimeManager } from "../util/TimeManager";
import type { IVariableCapturer, CaptureUniforms, CaptureCustomUniform, CaptureCompileContext } from "../capture/VariableCapturer";
import type { PixelRegionResult } from "./PixelRegion";

export interface RenderingEngine {
  initialize(glCanvas: HTMLCanvasElement, preserveDrawingBuffer?: boolean): void;
  handleCanvasResize(width: number, height: number): void;
  compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers?: Record<string, string>,
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
    slangModules?: SlangSourceModule[],
    slangSourcePath?: string,
  ): Promise<CompilationResult | undefined>;
  /** Compile a complete, in-place Slang debug workspace when the backend supports Slang. */
  compileSlangDebugPlan?(plan: DebugInstrumentationPlan): Promise<CompilationResult | undefined>;
  getCurrentConfig(): ShaderConfig | null;
  readStorageBuffer(name: string, start: number, count: number): Promise<StorageBufferSnapshot>;
  writeStorageBuffer(name: string, start: number, data: ArrayBuffer): Promise<void>;
  setInputEnabled(enabled: boolean): void;
  updateBufferAndRecompile(bufferName: string, bufferContent: string): Promise<CompilationResult | undefined>;
  getPasses(): any[];
  togglePause(): void;
  getTimeManager(): TimeManager;
  resetTime(): void;
  flagReloadOnNextApply(): void;
  startRenderLoop(): void;
  stopRenderLoop(): void;
  render(time?: number): void;
  getCurrentFPS(): number;
  getFrameTimeHistory(): number[];
  getFrameTimeCount(): number;
  setFPSLimit(limit: number): void;
  getUniforms(): import("../models").PassUniforms;
  cleanup(): void;
  requestPixelRegion(requestId: number, centerX: number, centerY: number): boolean;
  collectPixelRegionResults(): PixelRegionResult[];
  cancelPixelRegionRequests(): void;
  createVariableCapturer(): IVariableCapturer;
  getVariableCaptureCompileContext(code?: string, passName?: string, sourcePath?: string | null): CaptureCompileContext;
  /** Shader source dialect the engine renders ('glsl' for WebGL, 'slang' for WebGPU). */
  getShaderLanguage(): "glsl" | "slang";
  getCaptureUniforms(): CaptureUniforms;
  resumeAudioContext(): Promise<void>;
  resumeAllAudio(): void;
  resumeAllVideos(): void;
  releaseMediaResetHold(): void;
  updateAudioLoopRegion(path: string, startTime?: number, endTime?: number): void;
  setGlobalVolume(volume: number, muted: boolean): void;
  controlVideo(path: string, action: 'play' | 'pause' | 'mute' | 'unmute' | 'reset'): void;
  getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null;
  controlAudio(path: string, action: 'play' | 'pause' | 'mute' | 'unmute' | 'reset'): void;
  getAudioState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null;
  seekAudio(path: string, time: number): void;
  getAudioFFTData(type: string, path?: string): Uint8Array | null;
  getCustomUniformInfo(): { name: string; type: string }[];
  getCustomUniformDeclarations(): string;
  getCurrentCustomUniforms(): CaptureCustomUniform[];
  setCustomUniformValues(values: { name: string; type: string; value: number | number[] | boolean }[]): void;
  updateCustomUniformValues(changed: { name: string; type: string; value: number | number[] | boolean }[]): void;
  renderForCapture(): void;
  getCanvas(): HTMLCanvasElement | null;
  dispose(): void;
}
