import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type * as vscode from 'vscode';
import type { ShaderConfig } from '@shader-studio/types';

const mocks = vi.hoisted(() => ({ findFiles: vi.fn(), getExtension: vi.fn() }));
vi.mock('vscode', () => ({
  extensions: { getExtension: mocks.getExtension },
  workspace: { getConfiguration: () => ({ get: () => 3000 }), workspaceFolders: undefined, getWorkspaceFolder: () => undefined, findFiles: mocks.findFiles },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}));
vi.mock('../../app/services/Logger.js', () => ({ Logger: { trace: vi.fn() } }));
import { FileDialogHandler } from '../../app/handlers/FileDialogHandler.js';
import { ConfigPathConverter } from '../../app/transport/ConfigPathConverter.js';
import { WebSocketTransport } from '../../app/transport/WebSocketTransport.js';
import { ShaderProvider } from '../../app/ShaderProvider.js';
import { defaultAssetFiles, resolveDefaultAssetPath } from '../../app/DefaultAssets.js';
import { PathResolver } from '../../app/PathResolver.js';
import { WorkspaceFileScanner } from '../../app/WorkspaceFileScanner.js';
import type { Logger } from '../../app/services/Logger.js';

const extensionRoot = path.resolve('/extension');
const assets = [
  ['shader-studio://textures/nebula', 'nebula-texture.png'],
  ['shader-studio://cubemaps/desert', 'desert-cubemap-cross.png'],
];
const convert = (file: string) => `webview:${file}`;
const webview = { asWebviewUri: (uri: { fsPath: string }) => convert(uri.fsPath) } as unknown as vscode.Webview;

describe('VS Code default images', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getExtension.mockReturnValue({ extensionPath: extensionRoot });
  });
  it.each(assets)('resolves %s independently of the workspace', (uri, filename) => {
    expect(PathResolver.resolvePath('/project/main.glsl', uri)).toBe(path.join(extensionRoot, 'ui-dist', 'assets', filename));
  });
  it.each(['texture', 'cubemap'] as const)('preserves logical paths and resolves %s inputs with and without a shader path', async type => {
    for (const shaderPath of ['/project/main.glsl', undefined]) {
      for (const [uri, filename] of assets) {
        const message = { type: 'shaderSource', path: shaderPath, config: { version: '1.0' as const, passes: { Image: { inputs: { iChannel0: { type, path: uri } } } } } };
        const result = await ConfigPathConverter.processConfigPaths(message, webview);
        expect(result.config.passes.Image?.inputs?.iChannel0).toEqual({ type, path: uri, resolved_path: convert(path.join(extensionRoot, 'ui-dist', 'assets', filename)) });
        expect(message.config.passes.Image.inputs.iChannel0).not.toHaveProperty('resolved_path');
      }
    }
  });
  it.each([false, true])('lists defaults even when workspace scanning fails: %s', async fails => {
    const scan = vi.spyOn(WorkspaceFileScanner, 'scanFiles');
    if (fails) {
      scan.mockRejectedValue(new Error('scan failed'));
    } else {
      scan.mockResolvedValue([{ name: 'local.png', workspacePath: '@/local.png', thumbnailUri: 'webview:/local.png', isSameDirectory: true }]);
    }
    const handler = new FileDialogHandler(null!, null!, extensionRoot, null, () => 1, { error: vi.fn() } as unknown as Logger);
    const respond = vi.fn();
    await handler.handleRequestWorkspaceFiles({ extensions: ['png'], shaderPath: '/main.glsl' }, respond, convert);
    const files = respond.mock.calls[0][0].payload.files;
    expect(files).toHaveLength(fails ? 2 : 3);
    expect(files.slice(0, 2)).toEqual(assets.map(([uri, filename]) => expect.objectContaining({ workspacePath: uri, thumbnailUri: convert(path.join(extensionRoot, 'ui-dist', 'assets', filename)), isSameDirectory: false })));
  });
  it('lists the random volumes and resolves their stable paths for VS Code', async () => {
    const files = defaultAssetFiles(['ktx2'], extensionRoot, convert);
    expect(files.map(file => file.workspacePath)).toEqual([
      'shader-studio://volumes/noise-grey', 'shader-studio://volumes/noise-rgba',
    ]);
    for (const file of files) {
      const message = { type: 'shaderSource', path: '/project/main.glsl', config: { version: '1.0' as const, passes: { Image: { inputs: { iChannel0: { type: 'volume' as const, path: file.workspacePath } } } } } };
      const result = await ConfigPathConverter.processConfigPaths(message, webview);
      expect(result.config.passes.Image?.inputs?.iChannel0).toEqual({ type: 'volume', path: file.workspacePath, resolved_path: file.thumbnailUri });
      expect(file.thumbnailUri).toMatch(/ui-dist[/\\]assets[/\\]noise-(grey|rgba)\.ktx2$/);
    }
  });

  it('leaves unknown assets and missing extension installations unresolved', () => {
    expect(resolveDefaultAssetPath('shader-studio://textures/unknown')).toBeNull();
    expect(resolveDefaultAssetPath('./local.png')).toBeNull();
    mocks.getExtension.mockReturnValue(undefined);
    expect(resolveDefaultAssetPath(assets[0][0])).toBeNull();
  });
  it.each(assets)('resolves %s for browser rendering and refreshed previews', (uri, filename) => {
    const config = { version: '1.0' as const, passes: { Image: { inputs: { iChannel0: { type: 'texture' as const, path: uri } } } } };
    const provider: ShaderProvider = Object.assign(Object.create(ShaderProvider.prototype), { messenger: { getWebview: () => webview } });
    const pathMap = provider['buildPathMap'](config, '/project/main.glsl');
    const absolute = path.join(extensionRoot, 'ui-dist', 'assets', filename);
    expect(pathMap[uri]).toBe(convert(absolute));
    const transport: WebSocketTransport = Object.assign(Object.create(WebSocketTransport.prototype), { extensionPath: extensionRoot });
    const result = transport['processConfigPaths']({ type: 'shaderSource', path: '/project/main.glsl', config, pathMap });
    const url = `http://localhost:3000/assets/${filename}`;
    expect(result.config.passes.Image?.inputs?.iChannel0).toEqual({ type: 'texture', path: uri, resolved_path: url });
    expect(result.pathMap?.[uri]).toBe(url);
    expect(config.passes.Image.inputs.iChannel0).not.toHaveProperty('resolved_path');
  });
  it('does not offer images for audio requests', async () => {
    vi.spyOn(WorkspaceFileScanner, 'scanFiles').mockResolvedValue([]);
    const handler = new FileDialogHandler(null!, null!, extensionRoot, null, () => 1, null!);
    const respond = vi.fn();
    await handler.handleRequestWorkspaceFiles({ extensions: ['mp3'], shaderPath: '/main.glsl' }, respond, convert);
    expect(respond).toHaveBeenCalledWith({ type: 'workspaceFiles', payload: { files: [] } });
  });
  it.each(['./local.png', '/images/local.png'])('keeps ordinary paths working alongside defaults: %s', async inputPath => {
    const config = { version: '1.0' as const, passes: { Image: { inputs: { iChannel0: { type: 'texture' as const, path: inputPath } } } } };
    const expected = path.isAbsolute(inputPath) ? inputPath : '/project/local.png';
    expect(PathResolver.resolvePath('/project/main.glsl', inputPath)).toBe(expected);
    const provider: ShaderProvider = Object.assign(Object.create(ShaderProvider.prototype), { messenger: { getWebview: () => webview } });
    expect(provider['buildPathMap'](config, '/project/main.glsl')[inputPath]).toBe(convert(expected));
    for (const shaderPath of ['/project/main.glsl', undefined]) {
      const absolute = shaderPath ? expected : path.normalize(inputPath);
      const result = await ConfigPathConverter.processConfigPaths({ type: 'shaderSource', path: shaderPath, config }, webview);
      expect(result.config.passes.Image?.inputs?.iChannel0).toEqual({ type: 'texture', path: inputPath, resolved_path: convert(absolute) });
    }
    const transport: WebSocketTransport = Object.assign(Object.create(WebSocketTransport.prototype), { extensionPath: extensionRoot });
    const result = transport['processConfigPaths']({ type: 'shaderSource', path: '/project/main.glsl', config, pathMap: { [inputPath]: convert(expected) } });
    const url = `http://localhost:3000/textures/${encodeURIComponent(expected)}`;
    expect(result.config.passes.Image?.inputs?.iChannel0).toEqual({ type: 'texture', path: inputPath, resolved_path: url });
    expect(result.pathMap?.[inputPath]).toBe(url);
  });
  it('preserves remote browser texture URLs', () => {
    const uri = 'https://example.com/image.png';
    const config = { version: '1.0' as const, passes: { Image: { inputs: { iChannel0: { type: 'texture' as const, path: uri } } } } };
    const transport: WebSocketTransport = Object.assign(Object.create(WebSocketTransport.prototype), { extensionPath: extensionRoot });
    expect(transport['processConfigPaths']({ type: 'shaderSource', config }).config.passes.Image?.inputs?.iChannel0).toEqual({ type: 'texture', path: uri, resolved_path: uri });
  });

  it('ignores missing passes, inputs and paths when building preview maps', async () => {
    const provider: ShaderProvider = Object.assign(Object.create(ShaderProvider.prototype), { messenger: { getWebview: () => webview } });
    expect(provider['buildPathMap'](null, '/project/main.glsl')).toEqual({});
    // Persisted configs can be partial while the user edits them.
    for (const config of [
      { version: '1.0' },
      { version: '1.0', passes: { Image: null } },
      { version: '1.0', passes: { Image: {} } },
      { version: '1.0', passes: { Image: { inputs: null } } },
      { version: '1.0', passes: { Image: { inputs: { iChannel0: null, iChannel1: { type: 'keyboard' }, iChannel2: { type: 'texture', path: '' } } } } },
    ]) {
      const partial = config as unknown as ShaderConfig;
      expect(provider['buildPathMap'](partial, '/project/main.glsl')).toEqual({});
      const result = await ConfigPathConverter.processConfigPaths({ type: 'shaderSource', path: '/project/main.glsl', config: partial }, webview);
      expect(result.config).toEqual(partial);
    }
  });
  it.each(['video', 'audio'] as const)('resolves ordinary %s paths and respects skipped video processing', async type => {
    const input = { type, path: './media.mp4' };
    const config = { version: '1.0' as const, passes: { Image: { inputs: { iChannel0: input } } } };
    for (const skipVideoProcessing of [false, true]) {
      const result = await ConfigPathConverter.processConfigPaths({ type: 'shaderSource', path: '/project/main.glsl', config }, webview, { skipVideoProcessing });
      expect(result.config.passes.Image?.inputs?.iChannel0).toEqual(type === 'video' && skipVideoProcessing
        ? input : { ...input, resolved_path: convert('/project/media.mp4') });
    }
  });

});
