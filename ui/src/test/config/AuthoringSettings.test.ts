import { afterEach, expect, it, vi } from 'vitest';
import { AuthoringSettingsController } from '../../lib/config/AuthoringSettingsController';
import { getDefaultAuthoringMode, setDefaultAuthoringMode } from '../../lib/state/authoringModeState.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';
afterEach(() => setDefaultAuthoringMode('hooks'));
it('requests and applies global authoring settings and stops after disposal', () => {
  let receive: (event: MessageEvent) => void = () => {};
  const transport = { onMessage: vi.fn(handler => {
    receive = handler; 
  }), postMessage: vi.fn() } as unknown as Transport;
  const settings = new AuthoringSettingsController(transport);
  expect(transport.postMessage).toHaveBeenCalledWith({ type: 'requestShaderAuthoringSettings' });
  const send = (mode: string, type = 'shaderAuthoringSettings') => receive({ data: { type, payload: { defaultRenderAuthoring: mode } } } as MessageEvent);
  send('native'); expect(getDefaultAuthoringMode()).toBe('native');
  send('invalid'); send('hooks', 'other'); expect(getDefaultAuthoringMode()).toBe('native');
  settings.dispose(); send('hooks'); expect(getDefaultAuthoringMode()).toBe('native');
});
