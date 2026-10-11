import { getContext, setContext } from 'svelte';
import type { ShaderConfig } from '@shader-studio/types';

const KEY = Symbol('viewer-camera-shader-default');

export function provideViewerCameraDefault(config: () => ShaderConfig | null): void {
  setContext(KEY, () => config()?.webgpu?.useViewerCamera);
}

export function useViewerCameraDefault(): () => boolean | undefined {
  return getContext<() => boolean | undefined>(KEY) ?? (() => undefined);
}
