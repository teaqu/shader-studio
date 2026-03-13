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
  dispose(): void;
}
