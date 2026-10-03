import type { LiveInputPreview, LiveInputType } from "./LiveInputTextureManager";

interface PreviewResources {
  getAudioFFTData(path: string): Uint8Array | null;
  getLiveInputPreview(type: LiveInputType): LiveInputPreview | null;
}

export function audioPreviewData(resources: PreviewResources | null, type: string, path?: string): Uint8Array | null {
  return type === "audio" && path ? resources?.getAudioFFTData(path) ?? null : null;
}

export function livePreviewData(resources: PreviewResources | null, type: LiveInputType): LiveInputPreview | null {
  return resources?.getLiveInputPreview(type) ?? null;
}
