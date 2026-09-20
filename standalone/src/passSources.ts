import {
  configPathForShader,
  parseVertexPassKey,
  resolveConfiguredPath,
  vertexPassKey,
} from '@shader-studio/types';
import type { ConfiguredPathHost, ShaderConfig } from '@shader-studio/types';

/** The virtual workspace is rooted at `/`, so `@/` resolves from there;
 * `..` above the root clamps instead of escaping (the old resolver dropped
 * such passes; clamping keeps them addressable and `exists` still filters
 * anything that is not really there). */
export const virtualConfiguredPathHost: ConfiguredPathHost = {
  workspaceRootFor: () => '/',
  joinPath: (base, ...segments) => `${base}/${segments.join('/')}`,
  dirnameOf: (value) => value.slice(0, value.lastIndexOf('/')) || '/',
  normalizePath: (value) => {
    const parts: string[] = [];
    for (const part of value.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') {
        continue;
      }
      if (part === '..') {
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    return `/${parts.join('/')}`;
  },
  isAbsolutePath: (value) => value.startsWith('/'),
};


/**
 * Name of the pass whose source (or vertex source) is `filePath`, for the
 * shader at `shaderPath`. Separate editors open a pass file on its own, and
 * only the owning shader's config says which configured storage, channels and
 * stage that file is authored against.
 */
export function passNameForFile(
  config: ShaderConfig | null | undefined,
  shaderPath: string,
  filePath: string,
): string | undefined {
  const configPath = configPathForShader(shaderPath);
  for (const [name, pass] of Object.entries(config?.passes ?? {})) {
    if (!pass) {
      continue;
    }
    for (const [key, source] of [
      [name, 'path' in pass ? pass.path : undefined],
      [vertexPassKey(name), 'vertex' in pass ? pass.vertex : undefined],
    ] as const) {
      if (typeof source === 'string' && source
        && resolveConfiguredPath(virtualConfiguredPathHost, configPath, source) === filePath) {
        return key;
      }
    }
  }
  return undefined;
}

/** True when `bufferName` names a vertex source rather than a pass body. */
export function isVertexPassKey(bufferName: string): boolean {
  return parseVertexPassKey(bufferName) !== undefined;
}
