import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn((_: string, value: string) => `/workspace/${value}`) }));
vi.mock('vscode', () => ({ Uri: { file: (fsPath: string) => ({ fsPath }) } }));
vi.mock('../../app/PathResolver.ts', () => ({ PathResolver: { resolvePath: mocks.resolve } }));
import { ConfigPathConverter } from '../../app/transport/ConfigPathConverter.js';

describe('ConfigPathConverter volume paths', () => {
  it('resolves a volume path into a webview URI without changing its configured path', async () => {
    const webview = { asWebviewUri: vi.fn((uri: { fsPath: string }) => ({ toString: () => `webview:${uri.fsPath}` })) };
    const message = { type: 'shaderSource', path: '/workspace/shader.glsl', config: { version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'volume' as const, path: 'assets/density.ktx2' } } } } } };
    const result = await ConfigPathConverter.processConfigPaths(message, webview as never);
    expect(mocks.resolve).toHaveBeenCalledWith('/workspace/shader.glsl', 'assets/density.ktx2');
    const input = result.config.passes.Image?.inputs?.iChannel0;
    expect(input).toMatchObject({ path: 'assets/density.ktx2', resolved_path: 'webview:/workspace/assets/density.ktx2' });
    expect(message.config.passes.Image.inputs.iChannel0).not.toHaveProperty('resolved_path');
  });
});
