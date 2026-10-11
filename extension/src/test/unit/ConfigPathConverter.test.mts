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

  it('converts every supported resource kind while preserving unsupported and empty paths', async () => {
    const webview = { asWebviewUri: vi.fn((uri: { fsPath: string }) => ({ toString: () => `webview:${uri.fsPath}` })) };
    const message = { type: 'shaderSource', path: '/workspace/shader.glsl', config: { version: '1.0', passes: { Image: { inputs: {
      texture: { type: 'texture' as const, path: 'texture.png' }, video: { type: 'video' as const, path: 'clip.mp4' },
      audio: { type: 'audio' as const, path: 'sound.mp3' }, cube: { type: 'cubemap' as const, path: 'sky.png' },
      volume: { type: 'volume' as const, path: 'density.ktx2' }, buffer: { type: 'buffer' as const, source: 'BufferA' },
      empty: { type: 'texture' as const, path: '' },
    } } } } };
    const result = await ConfigPathConverter.processConfigPaths(message, webview as never);
    for (const key of ['texture', 'video', 'audio', 'cube', 'volume'] as const) {
      expect(result.config.passes.Image?.inputs?.[key]).toHaveProperty('resolved_path');
    }
    expect(result.config.passes.Image?.inputs?.buffer).not.toHaveProperty('resolved_path');
    expect(result.config.passes.Image?.inputs?.empty).not.toHaveProperty('resolved_path');
  });

  it('does not resolve video paths when video processing is skipped', async () => {
    const webview = { asWebviewUri: vi.fn() };
    const message = { type: 'shaderSource', config: { version: '1.0', passes: { Image: { inputs: { video: { type: 'video' as const, path: 'clip.mp4' } } } } } };
    const result = await ConfigPathConverter.processConfigPaths(message, webview as never, { skipVideoProcessing: true });
    expect(result.config.passes.Image?.inputs?.video).not.toHaveProperty('resolved_path');
    expect(webview.asWebviewUri).not.toHaveBeenCalled();
  });
});
