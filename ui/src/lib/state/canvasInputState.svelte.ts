import type { Transport } from '../transport/MessageTransport';

let disableContextMenu = $state(true);

export function getDisableCanvasContextMenu(): boolean {
  return disableContextMenu;
}

/** Keeps the global canvas preference synchronized with its host. */
export class CanvasInputSettings {
  private disposed = false;

  constructor(transport: Transport) {
    transport.onMessage(({ data }) => {
      if (!this.disposed && data.type === 'canvasInputSettings'
        && typeof data.payload?.disableContextMenu === 'boolean') {
        disableContextMenu = data.payload.disableContextMenu;
      }
    });
    transport.postMessage({ type: 'requestCanvasInputSettings' });
  }

  dispose(): void {
    this.disposed = true;
  }
}
