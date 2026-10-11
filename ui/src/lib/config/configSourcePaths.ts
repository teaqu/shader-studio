import { shaderLanguageForPath, type ShaderConfig, type ShaderLanguageId } from '@shader-studio/types';
/** Reuse shader files without writing source or copying another pass's configuration. */
export function configSourcePaths(config: ShaderConfig | null | undefined, rootPath: string, language: ShaderLanguageId): string[] {
  const paths = [rootPath, ...Object.values(config?.passes ?? {}).flatMap(pass =>
    pass ? [...('path' in pass && pass.path ? [pass.path] : []), ...(pass.vertex ? [pass.vertex] : [])] : [])];
  return [...new Set(paths.filter(path => shaderLanguageForPath(path) === language))];
}
