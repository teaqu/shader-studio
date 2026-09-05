import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Source aliases for every in-repo package.
 *
 * Shared by the viewer (`ui`) and the standalone shell (`standalone`) so the two
 * builds cannot drift apart. Host-specific entries (`@shader-studio/ui`,
 * `@shader-studio/shader-explorer`) are added by the shell that needs them.
 */
export const shaderStudioAliases = {
  '@shader-studio/debug': path.resolve(root, 'debug/src'),
  '@shader-studio/glsl-analysis': path.resolve(root, 'language-servers/glsl-analysis/src'),
  '@shader-studio/glsl-language-server': path.resolve(root, 'language-servers/glsl/src'),
  '@shader-studio/language-server-core': path.resolve(root, 'language-servers/core/src'),
  '@shader-studio/monaco': path.resolve(root, 'monaco/src'),
  '@shader-studio/rendering': path.resolve(root, 'rendering/src'),
  '@shader-studio/slang-language-server': path.resolve(root, 'language-servers/slang/src'),
  '@shader-studio/types': path.resolve(root, 'types/src'),
  '@shader-studio/utils': path.resolve(root, 'utils/src'),
};
