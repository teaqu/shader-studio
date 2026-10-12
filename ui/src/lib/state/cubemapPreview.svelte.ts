import type { CubemapFace, CubemapPreviewMode } from '../cubemapPreview';

export interface CubemapPreviewState {
  passName: string | null;
  mode: CubemapPreviewMode;
  face: CubemapFace;
  refresh: number;
}

const defaultState = (): CubemapPreviewState => ({ passName: null, mode: 'face', face: 'positive-z', refresh: 0 });
const previews = $state<Record<string, CubemapPreviewState>>({});

export function getCubemapPreview(shaderPath: string): CubemapPreviewState {
  return previews[shaderPath] ?? defaultState();
}

export function setCubemapPreview(shaderPath: string, value: Omit<CubemapPreviewState, 'refresh'>): void {
  const previous = previews[shaderPath];
  previews[shaderPath] = { ...value, refresh: (previous?.refresh ?? 0) + 1 };
}

export function clearCubemapPreview(shaderPath: string): void {
  const previous = previews[shaderPath];
  previews[shaderPath] = { ...defaultState(), refresh: (previous?.refresh ?? 0) + 1 };
}

export function resetCubemapPreviews(): void {
  for (const path of Object.keys(previews)) {
    delete previews[path];
  }
}
