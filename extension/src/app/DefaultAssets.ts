import * as path from 'path';
import * as vscode from 'vscode';
import { SHADER_STUDIO_DEFAULT_ASSETS, shaderStudioDefaultAssetRelativePath, type WorkspaceFileInfo } from '@shader-studio/types';

/** Resolve only catalogued assets; arbitrary logical URIs cannot access extension files. */
export function resolveDefaultAssetPath(uri: string, extensionPath?: string): string | null {
  const relativePath = shaderStudioDefaultAssetRelativePath(uri);
  if (!relativePath) {
    return null;
  }
  const root = extensionPath ?? vscode.extensions?.getExtension?.('teaqu.shader-studio')?.extensionPath;
  return root ? path.join(root, 'ui-dist', relativePath) : null;
}

export function defaultAssetFiles(extensions: string[], extensionPath: string, convert: (filePath: string) => string): WorkspaceFileInfo[] {
  return [
    { name: 'Nebula Texture.png', uri: SHADER_STUDIO_DEFAULT_ASSETS.nebulaTexture },
    { name: 'Desert Cubemap.png', uri: SHADER_STUDIO_DEFAULT_ASSETS.desertCubemap },
  ].filter(asset => extensions.includes(path.extname(asset.name).slice(1)))
    .map(({ name, uri }) => ({
      name,
      workspacePath: uri,
      thumbnailUri: convert(resolveDefaultAssetPath(uri, extensionPath)!),
      isSameDirectory: false,
    }));
}
