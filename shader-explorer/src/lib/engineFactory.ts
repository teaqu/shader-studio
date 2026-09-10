import { RenderingEngine as WebGLRenderingEngine } from '../../../rendering/src/webgl/RenderingEngine';
import { WebGPURenderingEngine } from '../../../rendering/src/webgpu/WebGPURenderingEngine';
import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';
import type { ShaderLanguage } from './shaderCodeRequest';
import { SHADER_LANGUAGES } from '@shader-studio/types';
import { getSlangAssetUrls } from './slangAssets';

export function createEngineForLanguage(language: ShaderLanguage | undefined): RenderingEngine {
  const id = language ?? 'glsl';
  if (SHADER_LANGUAGES[id].engine !== 'webgpu') {
    return new WebGLRenderingEngine();
  }
  // WGSL needs no Slang worker/WASM assets; Slang keeps the existing path.
  return id === 'wgsl'
    ? new WebGPURenderingEngine(undefined, id)
    : new WebGPURenderingEngine(getSlangAssetUrls(), id);
}
