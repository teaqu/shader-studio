import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }], getWorkspaceFolder: () => ({ uri: { fsPath: '/workspace' } }) },
}));
import { WebviewTransport } from '../../app/transport/WebviewTransport.js';
import { WebSocketTransport } from '../../app/transport/WebSocketTransport.js';
import { ConfigPathConverter } from '../../app/transport/ConfigPathConverter.js';
import type { Webview } from 'vscode';

const volumeMessage = () => ({
  type: 'shaderSource', path: '/workspace/shader.glsl',
  config: { version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'volume', path: 'assets/density.ktx2' } } } } },
});

describe('volume transport resources', () => {
  it('adds a volume directory to webview resource roots', () => {
    const webview = { options: { localResourceRoots: [] as Array<{ fsPath: string }> } };
    const transport = new WebviewTransport() as unknown as { panels: Set<unknown>; handleVideoResourceRoots(message: ReturnType<typeof volumeMessage>): void };
    transport.panels = new Set([{ webview }]);
    transport.handleVideoResourceRoots(volumeMessage());
    expect(webview.options.localResourceRoots).toEqual([{ fsPath: '/workspace/assets' }]);
  });

  it('keeps roots for each supported resource kind and ignores unsupported or URI paths', () => {
    const webview = { options: { localResourceRoots: [] as Array<{ fsPath: string }> } };
    const transport = new WebviewTransport() as unknown as { panels: Set<unknown>; handleVideoResourceRoots(message: object): void };
    transport.panels = new Set([{ webview }]);
    transport.handleVideoResourceRoots({ type: 'shaderSource', path: '/workspace/shader.glsl', config: { passes: { Image: { inputs: {
      texture: { type: 'texture', path: 'texture/a.png' }, video: { type: 'video', path: 'video/a.mp4' },
      audio: { type: 'audio', path: 'audio/a.mp3' }, cube: { type: 'cubemap', path: 'cube/a.png' },
      volume: { type: 'volume', path: 'volume/a.ktx2' }, buffer: { type: 'buffer', source: 'BufferA' },
      remote: { type: 'texture', path: 'vscode-webview://existing' },
    } } } } });
    expect(webview.options.localResourceRoots.map(root => root.fsPath).sort()).toEqual([
      '/workspace/audio', '/workspace/cube', '/workspace/texture', '/workspace/video', '/workspace/volume',
    ]);
  });

  it('converts volume paths for socket clients', () => {
    const process = (WebSocketTransport.prototype as unknown as { processConfigPaths(message: ReturnType<typeof volumeMessage>): ReturnType<typeof volumeMessage> }).processConfigPaths;
    const converted = process.call({ convertUriForClient: (value: string) => `client:${value}` }, volumeMessage());
    expect(converted.config.passes.Image.inputs.iChannel0).toMatchObject({ path: 'assets/density.ktx2', resolved_path: 'client:/workspace/assets/density.ktx2' });
  });
});

const storageMessage = () => ({
  type: 'shaderSource', path: '/workspace/shader.slang',
  config: { version: '1.0', storage: {
    data: { count: 4, elementType: 'uint', initialDataFiles: [{ path: 'data/values.bin' }, { path: '@/shared/next.bin', byteOffset: 8 }] },
    shared: { count: 4, elementType: 'uint', initialDataFiles: [{ path: '@/shared/table.bin' }] },
    remote: { count: 4, elementType: 'uint', initialDataFiles: [{ path: 'https://example.com/r.bin' }] },
    empty: { count: 4, elementType: 'uint', initialDataFiles: [{ path: '' }] },
    zero: { count: 4, elementType: 'uint' },
  } as Record<string, { count: number; elementType: string; initialDataFiles?: Array<{ path: string; byteOffset?: number; resolved_path?: string }> }>, passes: { Image: {} } },
});

describe('storage initial data transport resources', () => {
  it('resolves every file for webviews without mutating paths or offsets in the original config', async () => {
    const message = storageMessage();
    const webview = { asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `webview:${uri.fsPath}` }) } as unknown as Webview;
    const converted = await ConfigPathConverter.processConfigPaths(message, webview);
    expect(converted.config.storage?.data?.initialDataFiles).toEqual([
      { path: 'data/values.bin', resolved_path: 'webview:/workspace/data/values.bin' },
      { path: '@/shared/next.bin', byteOffset: 8, resolved_path: 'webview:/workspace/shared/next.bin' },
    ]);
    expect(message.config.storage.data.initialDataFiles).toEqual([{ path: 'data/values.bin' }, { path: '@/shared/next.bin', byteOffset: 8 }]);
  });
  it('adds each initial data file directory to webview resource roots', () => {
    const webview = { options: { localResourceRoots: [] as Array<{ fsPath: string }> } };
    const transport = new WebviewTransport() as unknown as { panels: Set<unknown>; handleVideoResourceRoots(message: ReturnType<typeof storageMessage>): void };
    transport.panels = new Set([{ webview }]);
    transport.handleVideoResourceRoots(storageMessage());
    expect(webview.options.localResourceRoots.map(root => root.fsPath)).toEqual(expect.arrayContaining(['/workspace/data', '/workspace/shared']));
  });

  it('converts initial data paths for socket clients without needing other transport methods', () => {
    const process = (WebSocketTransport.prototype as unknown as { processConfigPaths(message: ReturnType<typeof storageMessage>): ReturnType<typeof storageMessage> }).processConfigPaths;
    const converted = process.call({ convertUriForClient: (value: string) => `client:${value}` }, storageMessage());
    const storage = converted.config.storage;
    expect(storage.data.initialDataFiles![0]).toMatchObject({ path: 'data/values.bin', resolved_path: 'client:/workspace/data/values.bin' });
    expect(storage.data.initialDataFiles![1]).toMatchObject({ path: '@/shared/next.bin', byteOffset: 8, resolved_path: 'client:/workspace/shared/next.bin' });
    expect(storage.shared.initialDataFiles![0].resolved_path).toBe('client:/workspace/shared/table.bin');
    expect(storage.remote.initialDataFiles![0].resolved_path).toBe('client:https://example.com/r.bin');
    expect(storage.empty.initialDataFiles![0].resolved_path).toBeUndefined();
    expect(storage.zero.initialDataFiles).toBeUndefined();
  });
});
