import { expect, it, vi } from 'vitest';
import { CanvasInputSettings, getDisableCanvasContextMenu } from '../../lib/state/canvasInputState.svelte';
import type { Transport } from '../../lib/transport/MessageTransport';

it('defaults to suppressing menus, applies valid host settings, and stops on disposal', () => {
  let receive: (event: MessageEvent) => void = () => {};
  const transport = { onMessage: vi.fn(handler => {
    receive = handler;
  }), postMessage: vi.fn() } as unknown as Transport;
  expect(getDisableCanvasContextMenu()).toBe(true);
  const controller = new CanvasInputSettings(transport);
  expect(transport.postMessage).toHaveBeenCalledWith({ type: 'requestCanvasInputSettings' });
  const send = (value: unknown, type = 'canvasInputSettings') => receive({ data: { type, payload: { disableContextMenu: value } } } as MessageEvent);
  send(false); expect(getDisableCanvasContextMenu()).toBe(false);
  send('true'); send(true, 'other'); expect(getDisableCanvasContextMenu()).toBe(false);
  receive({ data: { type: 'canvasInputSettings' } } as MessageEvent);
  expect(getDisableCanvasContextMenu()).toBe(false);
  send(true); expect(getDisableCanvasContextMenu()).toBe(true);
  controller.dispose(); send(false); expect(getDisableCanvasContextMenu()).toBe(true);
});
