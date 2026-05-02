import type { ShaderConfig } from "@shader-studio/types";
import type { CompilationResult } from "../models";
import type { TimeManager } from "../util/TimeManager";
import type { VariableCapturer, CaptureUniforms, CaptureCustomUniform, CaptureCompileContext } from "../capture/VariableCapturer";

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
  ): Promise<CompilationResult | undefined>;
  getCurrentConfig(): ShaderConfig | null;
  setInputEnabled(enabled: boolean): void;
  updateBufferAndRecompile(bufferName: string, bufferContent: string): Promise<CompilationResult | undefined>;
  getPasses(): any[];
  togglePause(): void;
  getTimeManager(): TimeManager;
  startRenderLoop(): void;
  stopRenderLoop(): void;
  render(time?: number): void;
  getCurrentFPS(): number;
  getFrameTimeHistory(): number[];
  getFrameTimeCount(): number;
  setFPSLimit(limit: number): void;
  getUniforms(): import("../models").PassUniforms;
  cleanup(): void;
  readPixel(x: number, y: number): { r: number; g: number; b: number; a: number } | null;
  createVariableCapturer(): VariableCapturer;
  getVariableCaptureCompileContext(code?: string): CaptureCompileContext;
  getCaptureUniforms(): CaptureUniforms;
  resumeAudioContext(): Promise<void>;
  resumeAllAudio(): void;
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
