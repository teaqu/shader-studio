import type { Transport } from '../transport/MessageTransport';
import { setDefaultAuthoringMode } from '../state/authoringModeState.svelte';
export class AuthoringSettingsController {
  private disposed = false;
  constructor(transport: Transport) {
    transport.onMessage(event => {
      const mode = event.data.payload?.defaultRenderAuthoring;
      if (!this.disposed && event.data.type === 'shaderAuthoringSettings' && (mode === 'hooks' || mode === 'native')) {
        setDefaultAuthoringMode(mode);
      }
    });
    transport.postMessage({ type: 'requestShaderAuthoringSettings' });
  }
  dispose(): void {
    this.disposed = true; 
  }
}
