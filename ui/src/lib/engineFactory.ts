import { RenderingEngine as WebGLRenderingEngine } from "../../../rendering/src/webgl/RenderingEngine";
import { WebGPURenderingEngine } from "../../../rendering/src/webgpu/WebGPURenderingEngine";
import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";
import { SHADER_LANGUAGES, type ShaderLanguageId } from "@shader-studio/types";
import { getSlangAssetUrls } from "./slangAssets";

export type ShaderLanguage = ShaderLanguageId;

// Single place that knows which backend implements which shader language.
// Callers (live viewer, offscreen export) code against the RenderingEngine
// interface and stay backend-agnostic.
export function createEngineForLanguage(language: ShaderLanguage | undefined): RenderingEngine {
  const id = language ?? "glsl";
  if (SHADER_LANGUAGES[id].engine !== "webgpu") {
    return new WebGLRenderingEngine();
  }
  // WGSL needs no Slang worker/WASM assets; Slang keeps the existing path.
  return id === "wgsl"
    ? new WebGPURenderingEngine(undefined, id)
    : new WebGPURenderingEngine(getSlangAssetUrls(), id);
}
