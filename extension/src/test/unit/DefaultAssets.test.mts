import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type * as vscode from 'vscode';

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
import { resolveDefaultAssetPath } from '../../app/DefaultAssets.js';
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
});
