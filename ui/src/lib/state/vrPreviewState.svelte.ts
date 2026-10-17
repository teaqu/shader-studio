import type { RenderingEngineInterface as RenderingEngine } from '@shader-studio/rendering';
import { normalizeVrNavigation, type VrNavigationSettings } from '@shader-studio/rendering';

type VrEngine = Pick<RenderingEngine, 'isVrPreviewAvailable' | 'setVrPreviewEnabled' | 'render' | 'isImmersiveVrSupported' | 'enterVr' | 'exitVr' | 'setVrNavigationSettings'>;

const NAVIGATION_KEY = 'shader-studio-vr-navigation-v1';
function loadNavigation(): VrNavigationSettings {
  try {
    return normalizeVrNavigation(JSON.parse(globalThis.localStorage?.getItem(NAVIGATION_KEY) ?? 'null'));
  } catch {
    return normalizeVrNavigation(null);
  }
}
let navigation = $state<VrNavigationSettings>(loadNavigation());

export function getVrNavigationSettings(): VrNavigationSettings {
  return { ...navigation };
}

export function updateVrNavigationSettings(changes: Partial<VrNavigationSettings>): void {
  navigation = normalizeVrNavigation({ ...navigation, ...changes });
  engine?.setVrNavigationSettings?.({ ...navigation });
  try {
    globalThis.localStorage?.setItem(NAVIGATION_KEY, JSON.stringify(navigation));
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }
}

let engine = $state.raw<VrEngine | null>(null);
let available = $state(false);
let enabled = $state(false);
let supported = $state(false);
let immersive = $state(false);
let busy = $state(false);
let error = $state('');
let panelVisible = $state(false);

export function isVrPanelVisible(): boolean {
  return panelVisible;
}

export function setVrPanelVisible(visible: boolean): void {
  panelVisible = visible;
}

export function toggleVrPanel(): void {
  panelVisible = !panelVisible;
}
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
  engine?.setVrNavigationSettings?.({ ...navigation });
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
