import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }], getWorkspaceFolder: () => ({ uri: { fsPath: '/workspace' } }) },
}));
import { WebviewTransport } from '../../app/transport/WebviewTransport.js';
import { WebSocketTransport } from '../../app/transport/WebSocketTransport.js';

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
