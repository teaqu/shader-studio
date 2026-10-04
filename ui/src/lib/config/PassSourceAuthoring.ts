import { getShaderSourceFunctions, type BufferPass, type ImagePass, type ShaderLanguageId } from '@shader-studio/types';

export function existingShaderModes(source: string, language: ShaderLanguageId, stage: 'vertex' | 'fragment' | 'compute'): ('hooks' | 'native')[] {
  const hook = stage === 'vertex' ? 'mainVertex' : stage === 'fragment' ? 'mainImage' : 'compute';
  const functions = getShaderSourceFunctions(source, language === 'glsl' ? 'slang' : language);
  return [...(functions.some(fn => fn.name === hook || (stage === 'compute' && fn.stage === 'compute')) ? ['hooks' as const] : []),
    ...(functions.some(fn => fn.stage === stage) ? ['native' as const] : [])];
}
export interface CreatedSource {
  path: string;
  authoringMode?: 'hooks' | 'native';
  entryPoints?: { vertex?: string; fragment?: string; compute?: string };
  entryPoint?: string;
}

export function applyVertexSource(pass: BufferPass | ImagePass, result: CreatedSource): BufferPass | ImagePass {
  const { vertex: _vertex, ...rest } = pass.entryPoints ?? {};
  const entryPoints = result.authoringMode === 'native' ? { ...rest, vertex: result.entryPoints?.vertex } : rest;
  const { entryPoints: _entries, ...base } = pass;
  return { ...base, vertex: result.path, ...(Object.keys(entryPoints).length ? { entryPoints } : {}) };
}

export function bufferInsertionTarget(pass: BufferPass | ImagePass, shaderPath: string, suggestedPath: string): string {
  return 'path' in pass && pass.path ? pass.path : suggestedPath || shaderPath;
}

export function clearVertexSource(pass: BufferPass | ImagePass): BufferPass | ImagePass {
  const { vertex: _path, entryPoints: entries, ...rest } = pass;
  const { vertex: _entry, ...entryPoints } = entries ?? {};
  return { ...rest, ...(Object.keys(entryPoints).length ? { entryPoints } : {}) };
}

export function applyRenderSource(pass: BufferPass | ImagePass, result: CreatedSource): BufferPass | ImagePass {
  const { entryPoints, outputs, ...base } = pass as BufferPass;
  return { ...base, ...(result.path ? { path: result.path } : {}),
    ...(result.authoringMode === 'hooks' ? {} : { ...(entryPoints ? { entryPoints } : {}), ...(outputs ? { outputs } : {}) }),
    ...(result.authoringMode === 'native' || result.entryPoints ? { entryPoints: { ...entryPoints, ...result.entryPoints } } : {}) };
}
