import type { ShaderConfig } from "@shader-studio/types";
import { CompilationResult } from "../models";

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
  stopRenderLoop(): void;
  getCurrentFPS(): number;
  cleanup(): void;
  dispose(): void;
}
