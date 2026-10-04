import { configPathForShader, createVertexHookSource, createNativeComputeSource, createNativeRenderSource, resolveConfiguredPath, shaderLanguageForPath } from '@shader-studio/types';
import type { VirtualWorkspace } from './VirtualWorkspace';
import { virtualConfiguredPathHost } from './passSources';

/** Source insertion is shared by the editor and pass controls. */
export function insertShaderSource(workspace: VirtualWorkspace, activeShaderPath: string | null, payload: Record<string, unknown>, emitViewer: (message: { type: string; [key: string]: unknown }) => void, sendShaderList: () => void): void {
  const shaderPath = typeof payload.shaderPath === 'string' ? payload.shaderPath : activeShaderPath;
  const configuredSourcePath = typeof payload.sourcePath === 'string' ? payload.sourcePath : shaderPath;
  const fileType = typeof payload.fileType === 'string' ? payload.fileType : '';
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
  const fail = (error: string) => emitViewer({ type: 'fileSelected', payload: { path: '', requestId, error } });
  const sourcePath = shaderPath && configuredSourcePath
    ? resolveConfiguredPath(virtualConfiguredPathHost, configPathForShader(shaderPath), configuredSourcePath)
    : null;
  if (sourcePath && workspace.exists(sourcePath) && /^(glsl|slang|wgsl)-vertex$/.test(fileType)) {
    const language = shaderLanguageForPath(sourcePath);
    if (!language || fileType !== language + '-vertex') {
      fail('Insert source language must match the target source language.');
      return;
    }
    const source = workspace.readText(sourcePath);
    const text = createVertexHookSource(language, source, payload.geometryType === 'vertices');
    if (text) {
      workspace.writeText(sourcePath, source + text);
    }
    emitViewer({ type: 'fileSelected', payload: { path: sourcePath, requestId } });
    sendShaderList();
    return;
  }
  if (!shaderPath || !sourcePath || payload.authoringMode !== 'native' || !workspace.exists(sourcePath)) {
    fail('Insert into current source requires an existing native WebGPU source.');
    return;
  }
  const language = fileType.startsWith('wgsl-') ? 'wgsl' : fileType.startsWith('slang-') ? 'slang' : null;
  if (!language) {
    fail('Native source insertion is supported for WGSL and Slang only.');
    return;
  }
  if (fileType !== `${language}-buffer` && fileType !== `${language}-compute`) {
    fail('Insert supports Buffer and Compute pass sources only.');
    return;
  }
  if (shaderLanguageForPath(sourcePath) !== language) {
    fail('Insert source language must match the target source language.');
    return;
  }
  const source = workspace.readText(sourcePath);
  const passName = typeof payload.passName === 'string' ? payload.passName : fileType.endsWith('-compute') ? 'Compute' : 'Buffer';
  const generated = fileType.endsWith('-compute')
    ? createNativeComputeSource(language, source, passName)
    : createNativeRenderSource(language, source, passName, nativeOutputCount(payload.outputCount));
  workspace.writeText(sourcePath, source + generated.text);
  emitViewer({ type: 'fileSelected', payload: {
    path: sourcePath,
    requestId,
    authoringMode: 'native',
    entryPoints: generated.entryPoints,
  } });
  sendShaderList();
  return;
}

function nativeOutputCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.max(1, Math.min(8, value)) : 1;
}
