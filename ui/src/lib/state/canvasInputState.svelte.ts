import type { Transport } from '../transport/MessageTransport';

let preventMouseDefaults = $state(true);

export function getPreventCanvasMouseDefaults(): boolean {
  return preventMouseDefaults;
}

/** Keeps the global canvas preference synchronized with its host. */
export class CanvasInputSettings {
  private disposed = false;

  constructor(transport: Transport) {
    transport.onMessage(({ data }) => {
      if (!this.disposed && data.type === 'canvasInputSettings'
        && typeof data.payload?.preventMouseDefaults === 'boolean') {
        preventMouseDefaults = data.payload.preventMouseDefaults;
      }
    });
    transport.postMessage({ type: 'requestCanvasInputSettings' });
  }

  dispose(): void {
    this.disposed = true;
  }
}
