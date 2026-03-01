import { glslLanguageDefinition } from './glsl-language';
import { shaderStudioTheme, shaderStudioTransparentTheme } from './glsl-theme';

let registered = false;

/**
 * Register the GLSL language, themes, and worker stub for Monaco.
 * Safe to call multiple times — only registers once.
 *
 * @param monaco - The monaco-editor module instance
 */
export function setupMonacoGlsl(monaco: typeof import('monaco-editor')) {
  if (registered) return;

  // Worker stub — CSP blocks blob workers in VS Code webviews.
  // Monaco requires getWorker to return a Worker-like object.
  if (typeof self !== 'undefined' && !(self as any).MonacoEnvironment) {
    (self as any).MonacoEnvironment = {
      getWorker() {
        return {
          postMessage() {},
          onmessage: null,
          terminate() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
          onerror: null,
          onmessageerror: null,
        } as any;
      },
    };
  }

  // Register GLSL language if not already present
  if (!monaco.languages.getLanguages().some((lang) => lang.id === 'glsl')) {
    monaco.languages.register({ id: 'glsl' });
    monaco.languages.setMonarchTokensProvider('glsl', glslLanguageDefinition as any);
  }

  // Register themes
  monaco.editor.defineTheme('shader-studio', shaderStudioTheme);
  monaco.editor.defineTheme('shader-studio-transparent', shaderStudioTransparentTheme);

  registered = true;
}
