import { isAuthoringValueType, parseVertexPassKey, resourcesForSharedSource, shaderLanguageForPath, SHADER_LANGUAGES, stageForPass, type ShaderAuthoringEnvironment } from '@shader-studio/types';
import type { ShaderEditorProps } from './ShaderEditorProps';
import { commonAuthoringFile, slangAuthoringVirtualFiles } from './authoringVirtualFiles';
import { nativeAuthoringMetadata } from './nativeAuthoringMetadata';

export function shaderDocumentUri(path: string): string {
  return `file://${path.startsWith('/') ? '' : '/'}${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function shaderAuthoringEnvironment(
  props: ShaderEditorProps,
  generation: number,
  common: { path: string; text: string; version: number } | null,
  toUri: (path: string) => string = shaderDocumentUri,
): ShaderAuthoringEnvironment | null {
  const path = props.shaderPath ?? '';
  const language = shaderLanguageForPath(path);
  if (!language) {
    return null;
  }
  const buffer = props.activeBufferName ?? 'Image';
  const pass = parseVertexPassKey(buffer) ?? buffer;
  const commonFile = commonAuthoringFile(props.commonPath && props.commonSource !== undefined
    ? { path: props.commonPath, text: props.commonSource, version: common?.path === props.commonPath ? common.version : generation }
    : common, buffer, toUri);
  return {
    documentUri: toUri(path), languageId: language, generation, passName: pass,
    stage: parseVertexPassKey(buffer) !== undefined ? 'vertex' : stageForPass(props.config ?? null, pass, path),
    customUniforms: (props.customUniformInfo ?? []).flatMap(({ name, type }) => isAuthoringValueType(type) ? [{ name, type }] : []),
    resources: resourcesForSharedSource(props.config ?? null, pass, props.sourcePassNames ?? []),
    ...(commonFile && language !== 'slang' ? { commonFile } : {}),
    ...nativeAuthoringMetadata(props.shaderCode ?? '', language),
    virtualFiles: SHADER_LANGUAGES[language].hasImports ? slangAuthoringVirtualFiles(props.slangModules ?? [], pass, toUri) : [],
  };
}
