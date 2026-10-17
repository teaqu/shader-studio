import { describe, expect, it, vi } from 'vitest';

const configuration = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('vscode', () => ({ workspace: { getConfiguration: vi.fn(() => configuration) } }));
import { ClientMessageHandler } from '../../app/ClientMessageHandler.js';

describe('global canvas input preference', () => {
  it.each([true, false])('returns the configured context-menu preference (%s)', async value => {
    configuration.get.mockReturnValue(value);
    // Request handling does not need extension services or initialize an editor.
    const handler = Object.create(ClientMessageHandler.prototype) as ClientMessageHandler;
    Reflect.set(handler, 'logger', { debug: vi.fn() });
    const respond = vi.fn();
    await handler.handle({ type: 'requestCanvasInputSettings' }, respond);
    expect(configuration.get).toHaveBeenCalledWith('preview.preventMouseDefaults', true);
    expect(respond).toHaveBeenCalledWith({ type: 'canvasInputSettings', payload: { preventMouseDefaults: value } });
  });
  it('continues to route other viewer settings through the normal handler', async () => {
    configuration.get.mockReturnValue(false);
    const handler = Object.create(ClientMessageHandler.prototype) as ClientMessageHandler;
    Reflect.set(handler, 'logger', { debug: vi.fn() });
    const respond = vi.fn();
    await handler.handle({ type: 'requestViewerCameraSettings' }, respond);
    expect(respond).toHaveBeenCalledWith({ type: 'viewerCameraSettings', payload: { useViewerCamera: false } });
  });
});
