import type { CubemapFace, CubemapPreviewMode } from '../cubemapPreview';

export interface CubemapPreviewState {
  /** General pass selection, rather than a cubemap-specific inspection mode. */
  kind?: 'pass';
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

export function setPassPreview(shaderPath: string, passName: string): void {
  if (passName === 'Image') {
    clearCubemapPreview(shaderPath);
  } else {
    setCubemapPreview(shaderPath, { kind: 'pass', passName, mode: 'face', face: 'positive-z' });
  }
}

export function resetCubemapPreviews(): void {
  for (const path of Object.keys(previews)) {
    delete previews[path];
  }
}
