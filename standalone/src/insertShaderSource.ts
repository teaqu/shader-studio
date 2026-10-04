import { configPathForShader, createShaderInsertion, insertionLanguage, resolveConfiguredPath, shaderLanguageForPath } from '@shader-studio/types';
import type { VirtualWorkspace } from './VirtualWorkspace';
import { virtualConfiguredPathHost } from './passSources';

function sourceOptions(payload: Record<string, unknown>, fileType: string, authoringMode: 'hooks' | 'native') {
  const stringValue = (value: unknown) => typeof value === 'string' ? value : undefined;
  const count = payload.outputCount;
  return { fileType, authoringMode, passName: stringValue(payload.passName),
    geometryType: stringValue(payload.geometryType), vertexSpace: stringValue(payload.vertexSpace),
    outputCount: typeof count === 'number' && Number.isInteger(count) ? Math.max(1, Math.min(8, count)) : 1 };
}

/** Validate the destination before generating or writing shader code. */
export function insertShaderSource(workspace: VirtualWorkspace, activeShaderPath: string | null, payload: Record<string, unknown>, emitViewer: (message: { type: string; [key: string]: unknown }) => void, sendShaderList: () => void): void {
  const shaderPath = typeof payload.shaderPath === 'string' ? payload.shaderPath : activeShaderPath;
  const configured = typeof payload.sourcePath === 'string' ? payload.sourcePath : shaderPath;
  const fileType = typeof payload.fileType === 'string' ? payload.fileType : '';
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
  const fail = (error: string) => emitViewer({ type: 'fileSelected', payload: { path: '', requestId, error } });
  try {
    const language = insertionLanguage(fileType);
    const sourcePath = shaderPath && configured
      ? resolveConfiguredPath(virtualConfiguredPathHost, configPathForShader(shaderPath), configured) : null;
    if (!sourcePath) {
      throw new Error('Choose a source file before inserting shader code.');
    }
    if (shaderLanguageForPath(sourcePath) !== language) {
      throw new Error('Insert source language must match the target source language.');
    }
    const exists = workspace.exists(sourcePath);
    const mode = payload.authoringMode === 'native' ? 'native' : 'hooks';
    if (!exists && fileType.endsWith('-vertex')) {
      throw new Error('Create or insert the buffer source before adding a shader stage.');
    }
    const source = exists ? workspace.readText(sourcePath) : '';
    const result = createShaderInsertion(source, sourceOptions(payload, fileType, mode));
    if (result.text) {
      workspace.writeText(sourcePath, source + result.text);
    }
    emitViewer({ type: 'fileSelected', payload: { path: sourcePath, requestId,
      authoringMode: result.authoringMode, ...(result.entryPoints ? { entryPoints: result.entryPoints } : {}) } });
    sendShaderList();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
