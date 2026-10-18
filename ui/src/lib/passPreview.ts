import type { ShaderConfig } from '@shader-studio/types';
import { createCubemapPreview, type CubemapPreview, type CubemapPreviewRequest } from './cubemapPreview';
import type { CubemapPreviewState } from './state/cubemapPreview.svelte';
import type { ShaderDebugState } from './types/ShaderDebugState';

export type PassPreviewDebugState = Pick<ShaderDebugState, 'isEnabled' | 'isActive' | 'isInlineRenderingEnabled' | 'currentLine' | 'activeBufferName'>;

export function isLinePreviewActive(debug?: PassPreviewDebugState): boolean {
  return !!debug?.isEnabled && debug.isActive && debug.isInlineRenderingEnabled && debug.currentLine !== null;
}

export function getPreviewedPass(config: ShaderConfig | null, selection: CubemapPreviewState, debug?: PassPreviewDebugState): string {
  if (isLinePreviewActive(debug)) {
    return debug!.activeBufferName === 'common' ? 'Common' : debug!.activeBufferName;
  }
  const name = selection.passName;
  if (!name || !canPreviewPass(config, name)) {
    return 'Image';
  }
  const pass = config?.passes[name];
  return selection.kind === 'pass' || (pass && 'outputKind' in pass && pass.outputKind === 'cubemap') ? name : 'Image';
}

/** Only image-producing passes can be shown on the preview canvas. */
export function canPreviewPass(config: ShaderConfig | null, passName: string): boolean {
  if (passName === 'Image') {
    return true;
  }
  const pass = config?.passes[passName];
  return !!pass && passName !== 'common' && !('type' in pass && pass.type === 'compute');
}

/** Replace only the display pass; buffers retain their inputs and feedback. Never persist this config. */
export function createPassPreview(request: CubemapPreviewRequest): CubemapPreview | null {
  if (request.passName === 'Image' || !request.config || !canPreviewPass(request.config, request.passName)) {
    return null;
  }
  const cube = createCubemapPreview(request);
  if (cube) {
    return cube;
  }
  const code = request.language === 'glsl'
    ? 'void mainImage(out vec4 color, vec2 coord) { color = texture(iChannel0, coord / iResolution.xy); }'
    : request.language === 'slang'
      ? 'float4 mainImage(float2 coord) { return iChannel0.Sample(coord / iResolution.xy); }'
      : 'fn mainImage(coord: vec2f) -> vec4f { return iChannel0Sample(coord / iResolution.xy); }';
  const resolution = request.config.passes.Image?.resolution;
  return { code, config: { ...request.config, passes: { ...request.config.passes, Image: {
    ...(resolution ? { resolution } : {}),
    inputs: { iChannel0: { type: 'buffer', source: request.passName, filter: 'linear', wrap: 'clamp' } },
  } } } };
}
