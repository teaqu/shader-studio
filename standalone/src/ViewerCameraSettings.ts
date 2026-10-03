import type { ViewerCameraSettingsMessage } from "@shader-studio/types";

const STORAGE_KEY = 'shader-studio.webgpu.useViewerCamera';
type StorageBackend = Pick<Storage, 'getItem' | 'setItem'>;

function availableStorage(): StorageBackend | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export class ViewerCameraSettings {
  private value: boolean;
  private readonly storage: StorageBackend | undefined;

  constructor(storage: StorageBackend | undefined = availableStorage()) {
    let stored: string | null | undefined;
    try {
      stored = storage?.getItem(STORAGE_KEY);
    } catch {
      stored = undefined;
    }
    this.value = stored === 'false' ? false : true;
    this.storage = storage;
  }

  handleMessage(type: string, payload: Record<string, unknown>, reply: (message: ViewerCameraSettingsMessage) => void): boolean {
    if (type !== 'requestViewerCameraSettings' && type !== 'updateViewerCameraSettings') {
      return false;
    }
    if (type === 'updateViewerCameraSettings') {
      if (typeof payload.useViewerCamera !== 'boolean') {
        return true;
      }
      this.set(payload.useViewerCamera);
    }
    reply({ type: 'viewerCameraSettings', payload: { useViewerCamera: this.value } });
    return true;
  }

  get useViewerCamera(): boolean {
    return this.value;
  }

  set(useViewerCamera: boolean): void {
    this.value = useViewerCamera;
    try {
      this.storage?.setItem(STORAGE_KEY, String(useViewerCamera));
    } catch {
      // Browsers can deny localStorage even when the API exists. Keep the setting for this session.
    }
  }
}
