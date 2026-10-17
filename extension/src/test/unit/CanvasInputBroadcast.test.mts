import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { Messenger } from '../../app/transport/Messenger.js';
import type { ShaderProvider } from '../../app/ShaderProvider.js';
import type { GlslFileTracker } from '../../app/GlslFileTracker.js';

const workspace = vi.hoisted(() => ({ getConfiguration: vi.fn(), onDidChangeConfiguration: vi.fn() }));
vi.mock('vscode', () => ({ workspace }));
vi.mock('../../app/ClientMessageHandler.js', () => ({ ClientMessageHandler: class {} }));
vi.mock('../../app/services/Logger.js', () => ({ Logger: { getInstance: () => ({ debug: vi.fn() }) } }));
import { PanelManager } from '../../app/PanelManager.js';

describe('canvas preference broadcasts', () => {
  it.each([true, false])('broadcasts live global changes to every viewer transport (%s)', value => {
    let receive: (event: vscode.ConfigurationChangeEvent) => void = () => {};
    workspace.onDidChangeConfiguration.mockImplementation(callback => {
      receive = callback;
      return { dispose: vi.fn() };
    });
    const get = vi.fn(() => value);
    workspace.getConfiguration.mockReturnValue({ get });
    const messenger = { addTransport: vi.fn(), removeTransport: vi.fn(), send: vi.fn() };
    const context = { subscriptions: [], extensionPath: '/extension' } as unknown as vscode.ExtensionContext;
    const manager = new PanelManager(context, messenger as unknown as Messenger, {} as ShaderProvider, {} as GlslFileTracker);
    try {
      const event = (name: string) => ({ affectsConfiguration: (section: string) => section === name }) as vscode.ConfigurationChangeEvent;
      receive(event('unrelated'));
      expect(messenger.send).not.toHaveBeenCalled();
      receive(event('shader-studio.preview.preventMouseDefaults'));
      expect(get).toHaveBeenCalledWith('preview.preventMouseDefaults', true);
      expect(messenger.send).toHaveBeenCalledExactlyOnceWith({ type: 'canvasInputSettings', payload: { preventMouseDefaults: value } });
    } finally {
      manager.dispose();
    }
  });
});
