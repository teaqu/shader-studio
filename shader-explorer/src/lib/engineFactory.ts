import { RenderingEngine as WebGLRenderingEngine } from '../../../rendering/src/webgl/RenderingEngine';
import { WebGPURenderingEngine } from '../../../rendering/src/webgpu/WebGPURenderingEngine';
import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';
import type { ShaderLanguage } from './shaderCodeRequest';
import { getSlangAssetUrls } from './slangAssets';

export function createEngineForLanguage(language: ShaderLanguage | undefined): RenderingEngine {
  return language === 'slang'
    ? new WebGPURenderingEngine(getSlangAssetUrls())
    : new WebGLRenderingEngine();
}
