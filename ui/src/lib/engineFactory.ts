import { RenderingEngine as WebGLRenderingEngine } from "../../../rendering/src/webgl/RenderingEngine";
import { WebGPURenderingEngine } from "../../../rendering/src/webgpu/WebGPURenderingEngine";
import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";
import { getSlangAssetUrls } from "./slangAssets";

export type ShaderLanguage = "glsl" | "slang";

// Single place that knows which backend implements which shader language.
// Callers (live viewer, offscreen export) code against the RenderingEngine
// interface and stay backend-agnostic.
export function createEngineForLanguage(language: ShaderLanguage | undefined): RenderingEngine {
  return language === "slang"
    ? new WebGPURenderingEngine(getSlangAssetUrls())
    : new WebGLRenderingEngine();
}
