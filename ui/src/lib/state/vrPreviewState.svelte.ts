import type { RenderingEngineInterface as RenderingEngine } from '@shader-studio/rendering';

type VrEngine = Pick<RenderingEngine, 'isVrPreviewAvailable' | 'setVrPreviewEnabled' | 'render' | 'isImmersiveVrSupported' | 'enterVr' | 'exitVr'>;

let engine = $state.raw<VrEngine | null>(null);
let available = $state(false);
let enabled = $state(false);
let supported = $state(false);
let immersive = $state(false);
let busy = $state(false);
let error = $state('');
let shaderPath = '';
let generation = 0;

export function updateVrPreviewContext(nextEngine: VrEngine | null, path: string, success = true): void {
  if (!success) {
    if (engine === nextEngine && shaderPath === path) {
      return;
    }
    nextEngine = null;
  }
  const nextAvailable = nextEngine?.isVrPreviewAvailable?.() ?? false;
  const changed = engine !== nextEngine || shaderPath !== path || available !== nextAvailable;
  if (changed) {
    generation++;
    engine?.setVrPreviewEnabled?.(false);
    void engine?.exitVr?.().catch(() => {});
    enabled = false;
    immersive = false;
    busy = false;
    supported = false;
    error = '';
  }
  engine = nextEngine;
  shaderPath = path;
  available = nextAvailable;
  engine?.setVrPreviewEnabled?.(enabled);
  if (changed && available) {
    probeHeadsetSupport();
  }
}


function probeHeadsetSupport(): void {
  const token = generation;
  void engine?.isImmersiveVrSupported?.().then(value => {
    if (token === generation) {
      supported = value;
    }
  }).catch(() => {});
}

export function getVrPreviewState(): { available: boolean; enabled: boolean; supported: boolean; immersive: boolean; busy: boolean; error: string } {
  return { available, enabled, supported, immersive, busy, error };
}

export function toggleVrPreview(): void {
  if (!available || immersive || busy) {
    return;
  }
  enabled = !enabled;
  engine?.setVrPreviewEnabled?.(enabled);
  engine?.render();
}

export async function toggleImmersiveVr(): Promise<void> {
  if (!available || !supported || busy || !engine?.enterVr || !engine.exitVr) {
    return;
  }
  const current = engine;
  const token = generation;
  busy = true;
  error = '';
  try {
    if (immersive) {
      await current.exitVr!();
      if (token === generation) {
        immersive = false;
      }
    } else {
      let ended = false;
      // Call immediately from the click handler to retain WebXR user activation.
      await current.enterVr!(message => {
        ended = true;
        if (token !== generation) {
          return;
        }
        immersive = false;
        busy = false;
        error = message ?? '';
      });
      if (token === generation) {
        immersive = !ended;
      } else {
        await current.exitVr!();
      }
    }
  } catch (cause) {
    if (token === generation) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    if (token === generation) {
      busy = false;
    }
  }
}
