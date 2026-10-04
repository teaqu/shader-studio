import type { BufferPass, ImagePass } from '@shader-studio/types';
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

export function applyRenderSource(pass: BufferPass | ImagePass, result: CreatedSource): BufferPass | ImagePass {
  const { entryPoints, outputs, ...base } = pass as BufferPass;
  return { ...base, ...(result.path ? { path: result.path } : {}),
    ...(result.authoringMode === 'hooks' ? {} : { ...(entryPoints ? { entryPoints } : {}), ...(outputs ? { outputs } : {}) }),
    ...(result.authoringMode === 'native' || result.entryPoints ? { entryPoints: result.entryPoints ?? {} } : {}) };
}
