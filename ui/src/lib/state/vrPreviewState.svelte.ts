import type { RenderingEngineInterface as RenderingEngine } from '@shader-studio/rendering';

type VrEngine = Pick<RenderingEngine, 'isVrPreviewAvailable' | 'setVrPreviewEnabled' | 'render'>;

let engine = $state.raw<VrEngine | null>(null);
let available = $state(false);
let enabled = $state(false);
let shaderPath = '';

export function updateVrPreviewContext(nextEngine: VrEngine | null, path: string, success = true): void {
  if (!success) {
    if (engine === nextEngine && shaderPath === path) {
      return;
    }
    nextEngine = null;
  }
  if (engine !== nextEngine || shaderPath !== path) {
    engine?.setVrPreviewEnabled?.(false);
    enabled = false;
  }
  engine = nextEngine;
  shaderPath = path;
  available = engine?.isVrPreviewAvailable?.() ?? false;
  if (!available) {
    enabled = false;
  }
  engine?.setVrPreviewEnabled?.(enabled);
}

export function getVrPreviewState(): { available: boolean; enabled: boolean } {
  return { available, enabled };
}

export function toggleVrPreview(): void {
  if (!available) {
    return;
  }
  enabled = !enabled;
  engine?.setVrPreviewEnabled?.(enabled);
  engine?.render();
}
