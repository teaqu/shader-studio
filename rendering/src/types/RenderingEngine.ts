import type { ShaderConfig } from "@shader-studio/types";
import type { CompilationResult } from "../models";
import type { TimeManager } from "../util/TimeManager";

export interface RenderingEngine {
  initialize(glCanvas: HTMLCanvasElement): void;
  handleCanvasResize(width: number, height: number): void;
  compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers?: Record<string, string>,
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
  cleanup(): void;
  readPixel(x: number, y: number): { r: number; g: number; b: number; a: number } | null;
  dispose(): void;
}
