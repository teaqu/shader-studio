import type { LiveInputPreview, LiveInputType } from "./LiveInputTextureManager";

interface PreviewResources {
  controlAudioInput(action: "start" | "stop", deviceId?: string): Promise<string | undefined>;
  controlSystemAudio(action: "start" | "stop", deviceId?: string): Promise<string | undefined>;
  getAudioFFTData(path: string): Uint8Array | null;
  getLiveInputPreview(type: LiveInputType): LiveInputPreview | null;
}

export function audioPreviewData(resources: PreviewResources | null, type: string, path?: string): Uint8Array | null {
  return type === "audio" && path ? resources?.getAudioFFTData(path) ?? null : null;
}

export function livePreviewData(resources: PreviewResources | null, type: LiveInputType): LiveInputPreview | null {
  return resources?.getLiveInputPreview(type) ?? null;
}

export function controlSystemAudio(resources: PreviewResources | null, action: "start" | "stop", deviceId?: string): Promise<string | undefined> {
  return resources?.controlSystemAudio(action, deviceId) ?? Promise.resolve("Shader is not ready. Try again after it loads.");
}

export function controlAudioInput(resources: PreviewResources | null, action: "start" | "stop", deviceId?: string): Promise<string | undefined> {
  return resources?.controlAudioInput(action, deviceId) ?? Promise.resolve("Shader is not ready. Try again after it loads.");
}
