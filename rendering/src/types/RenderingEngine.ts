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
    buffers?: Record<string, string>
  ): Promise<CompilationResult | undefined>;
  isLockedShader(): boolean;
  togglePause(): void;
  toggleLock(path: string): void;
  getLockedShaderPath(): string | undefined;
  getTimeManager(): TimeManager;
  startRenderLoop(): void;
  stopRenderLoop(): void;
  render(time?: number): void;
  getCurrentFPS(): number;
  cleanup(): void;
  dispose(): void;
}
