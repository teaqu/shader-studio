import { expect, it, vi } from 'vitest';
import { CanvasInputSettings, getPreventCanvasMouseDefaults } from '../../lib/state/canvasInputState.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';

it('defaults to suppressing menus, applies valid host settings, and stops on disposal', () => {
  let receive: (event: MessageEvent) => void = () => {};
  const transport = { onMessage: vi.fn(handler => {
    receive = handler;
  }), postMessage: vi.fn() } as unknown as Transport;
  expect(getPreventCanvasMouseDefaults()).toBe(true);
  const controller = new CanvasInputSettings(transport);
  expect(transport.postMessage).toHaveBeenCalledWith({ type: 'requestCanvasInputSettings' });
  const send = (value: unknown, type = 'canvasInputSettings') => receive({ data: { type, payload: { preventMouseDefaults: value } } } as MessageEvent);
  send(false); expect(getPreventCanvasMouseDefaults()).toBe(false);
  send('true'); send(true, 'other'); expect(getPreventCanvasMouseDefaults()).toBe(false);
  receive({ data: { type: 'canvasInputSettings' } } as MessageEvent);
  expect(getPreventCanvasMouseDefaults()).toBe(false);
  send(true); expect(getPreventCanvasMouseDefaults()).toBe(true);
  controller.dispose(); send(false); expect(getPreventCanvasMouseDefaults()).toBe(true);
});
