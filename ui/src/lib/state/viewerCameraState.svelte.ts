import type { ShaderConfig } from '@shader-studio/types';

let useViewerCamera = $state(true);

export function getGlobalViewerCamera(): boolean {
  return useViewerCamera;
}

export function setGlobalViewerCamera(value: boolean): void {
  useViewerCamera = value;
}

/** Runtime-only default: never write the user's global preference into a shader. */
export function viewerCameraRuntimeConfig(config: ShaderConfig | null): ShaderConfig | null {
  if (!config || config.webgpu?.useViewerCamera !== undefined || useViewerCamera) {
    return config;
  }
  return { ...config, webgpu: { ...config.webgpu, useViewerCamera } };
}
