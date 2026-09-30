import path from 'path';
import { createRequire } from 'module';
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
  '@shader-studio/wgsl-analysis': path.resolve(root, 'language-servers/wgsl-analysis/src'),
  '@shader-studio/wgsl-language-server': path.resolve(root, 'language-servers/wgsl/src'),
  '@shader-studio/types': path.resolve(root, 'types/src'),
  '@shader-studio/utils': path.resolve(root, 'utils/src'),
};

/**
 * Monaco's `esm/vs` directory, found through the package's own exports map so
 * it follows whichever copy the workspace installs.
 */
const monacoEsmRoot = path.dirname(path.dirname(
  createRequire(import.meta.url).resolve('monaco-editor/editor/editor.api.js'),
));

/**
 * Monaco 0.57 added an exports map rooting deep imports at `esm/vs/`, so the
 * pre-0.57 `monaco-editor/esm/vs/...` paths that monaco-vim still imports no
 * longer resolve. Vite then ships them as bare specifiers and the webview
 * fails to load the app. Point them at the same files the app imports, so
 * there is still only one Monaco instance.
 */
export const monacoLegacyEsmAlias = {
  find: /^monaco-editor\/esm\/vs\/(.+?)(?:\.js)?$/,
  replacement: `${monacoEsmRoot}/$1.js`,
};

/**
 * Every shared alias in Vite's array form, which unlike the object form
 * supports pattern matches. Builds that bundle the editor use this.
 */
export const shaderStudioAliasEntries = [
  ...Object.entries(shaderStudioAliases).map(([find, replacement]) => ({ find, replacement })),
  monacoLegacyEsmAlias,
];
