import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: { workspaceFolders: [{ uri: { fsPath: '/workspace' } }], getWorkspaceFolder: () => ({ uri: { fsPath: '/workspace' } }) },
}));
import { WebviewTransport } from '../../app/transport/WebviewTransport.ts';
import { WebSocketTransport } from '../../app/transport/WebSocketTransport.ts';

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

  it('converts volume paths for socket clients', () => {
    const process = (WebSocketTransport.prototype as unknown as { processConfigPaths(message: ReturnType<typeof volumeMessage>): ReturnType<typeof volumeMessage> }).processConfigPaths;
    const converted = process.call({ convertUriForClient: (value: string) => `client:${value}` }, volumeMessage());
    expect(converted.config.passes.Image.inputs.iChannel0).toMatchObject({ path: 'assets/density.ktx2', resolved_path: 'client:/workspace/assets/density.ktx2' });
  });
});
