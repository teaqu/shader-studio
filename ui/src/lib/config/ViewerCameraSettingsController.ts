import type { Transport } from '../transport/MessageTransport';
import { getGlobalViewerCamera, setGlobalViewerCamera } from '../state/viewerCameraState.svelte';

export class ViewerCameraSettingsController {
  private disposed = false;

  constructor(transport: Transport, onChanged: () => void) {
    transport.onMessage(event => {
      const message = event.data;
      if (this.disposed || message.type !== 'viewerCameraSettings' || typeof message.payload?.useViewerCamera !== 'boolean') {
        return;
      }
      const changed = getGlobalViewerCamera() !== message.payload.useViewerCamera;
      setGlobalViewerCamera(message.payload.useViewerCamera);
      if (changed) {
        onChanged();
      }
    });
    transport.postMessage({ type: 'requestViewerCameraSettings' });
  }

  dispose(): void {
    this.disposed = true;
  }
}
