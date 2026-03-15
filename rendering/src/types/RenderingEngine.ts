import type { ShaderConfig } from "@shader-studio/types";
import type { CompilationResult } from "../models";
import type { TimeManager } from "../util/TimeManager";
import type { VariableCapturer, CaptureUniforms } from "../capture/VariableCapturer";

export interface RenderingEngine {
  initialize(glCanvas: HTMLCanvasElement, preserveDrawingBuffer?: boolean): void;
  handleCanvasResize(width: number, height: number): void;
  compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers?: Record<string, string>,
    audioOptions?: { muted?: boolean; volume?: number },
  ): Promise<CompilationResult | undefined>;
  getCurrentConfig(): ShaderConfig | null;
  updateBufferAndRecompile(bufferName: string, bufferContent: string): Promise<CompilationResult | undefined>;
  getPasses(): any[];
  togglePause(): void;
  getTimeManager(): TimeManager;
  startRenderLoop(): void;
  stopRenderLoop(): void;
  render(time?: number): void;
  getCurrentFPS(): number;
  setFPSLimit(limit: number): void;
  getUniforms(): import("../models").PassUniforms;
  cleanup(): void;
  readPixel(x: number, y: number): { r: number; g: number; b: number; a: number } | null;
  createVariableCapturer(): VariableCapturer;
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
  renderForCapture(): void;
  getCanvas(): HTMLCanvasElement | null;
  dispose(): void;
}
