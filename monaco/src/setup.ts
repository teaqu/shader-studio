import { glslLanguageDefinition } from './glsl-language';
import {
  shaderStudioTheme,
  shaderStudioTransparentLightTheme,
  shaderStudioTransparentTheme,
} from './glsl-theme';
import { slangLanguageDefinition } from './slang-language';

let registered = false;
const slangRegistrations = new WeakSet<object>();

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
  monaco.editor.defineTheme('shader-studio-transparent-light', shaderStudioTransparentLightTheme);

  registered = true;
}

/** Register the Slang Monarch tokenizer independently from GLSL. */
export function setupMonacoSlang(monaco: typeof import('monaco-editor')) {
  if (slangRegistrations.has(monaco)) return;

  if (!monaco.languages.getLanguages().some((language) => language.id === 'slang')) {
    monaco.languages.register({ id: 'slang' });
  }
  monaco.languages.setMonarchTokensProvider('slang', slangLanguageDefinition);

  slangRegistrations.add(monaco);
}
