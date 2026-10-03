import { glslLanguageDefinition } from './glsl-language';
import { shaderLanguageConfiguration } from './language-configuration';
import {
  shaderStudioTheme,
  shaderStudioTransparentLightTheme,
  shaderStudioTransparentTheme,
} from './glsl-theme';
import { slangLanguageDefinition } from './slang-language';
import { wgslLanguageDefinition } from './wgsl-language';
import { jsonLanguageConfiguration, jsonLanguageDefinition } from './json-language';
import type * as Monaco from 'monaco-editor/editor/editor.api.js';

let registered = false;
const slangRegistrations = new WeakSet<object>();
const wgslRegistrations = new WeakSet<object>();
const jsonRegistrations = new WeakSet<object>();
type MonacoEnvironmentHost = typeof globalThis & {
  MonacoEnvironment?: { getWorker(): Worker };
};

/**
 * Register the GLSL language, themes, and worker stub for Monaco.
 * Safe to call multiple times — only registers once.
 *
 * @param monaco - The monaco-editor module instance
 */
export function setupMonacoGlsl(monaco: typeof import('monaco-editor/editor/editor.api.js')) {
  if (registered) {
    return;
  }

  // Worker stub — CSP blocks blob workers in VS Code webviews.
  // Monaco requires getWorker to return a Worker-like object.
  if (typeof self !== 'undefined') {
    const globalScope = self as MonacoEnvironmentHost;
    if (!globalScope.MonacoEnvironment) {
      globalScope.MonacoEnvironment = {
        getWorker() {
          // Monaco only observes this worker through its lifecycle methods; CSP
          // prevents the real worker implementation in extension webviews.
          return {
            postMessage() {},
            onmessage: null,
            terminate() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return false;
            },
            onerror: null,
            onmessageerror: null,
          } as unknown as Worker;
        },
      };
    }
  }

  // Register GLSL language if not already present
  if (!monaco.languages.getLanguages().some((lang) => lang.id === 'glsl')) {
    monaco.languages.register({ id: 'glsl' });
    monaco.languages.setMonarchTokensProvider('glsl', glslLanguageDefinition as Monaco.languages.IMonarchLanguage);
  }

  // Brackets and indentation rules — without these Enter after `{` does not indent.
  monaco.languages.setLanguageConfiguration('glsl', shaderLanguageConfiguration);

  // Register themes
  monaco.editor.defineTheme('shader-studio', shaderStudioTheme);
  monaco.editor.defineTheme('shader-studio-transparent', shaderStudioTransparentTheme);
  monaco.editor.defineTheme('shader-studio-transparent-light', shaderStudioTransparentLightTheme);

  registered = true;
}

/** Register the Slang Monarch tokenizer independently from GLSL. */
export function setupMonacoSlang(monaco: typeof import('monaco-editor/editor/editor.api.js')) {
  if (slangRegistrations.has(monaco)) {
    return;
  }

  if (!monaco.languages.getLanguages().some((language) => language.id === 'slang')) {
    monaco.languages.register({ id: 'slang' });
  }
  monaco.languages.setMonarchTokensProvider('slang', slangLanguageDefinition);
  monaco.languages.setLanguageConfiguration('slang', shaderLanguageConfiguration);

  slangRegistrations.add(monaco);
}

/** Register the WGSL Monarch tokenizer independently from GLSL and Slang. */
export function setupMonacoWgsl(monaco: typeof import('monaco-editor/editor/editor.api.js')) {
  if (wgslRegistrations.has(monaco)) {
    return;
  }

  if (!monaco.languages.getLanguages().some((language) => language.id === 'wgsl')) {
    monaco.languages.register({ id: 'wgsl' });
  }
  monaco.languages.setMonarchTokensProvider('wgsl', wgslLanguageDefinition);
  monaco.languages.setLanguageConfiguration('wgsl', shaderLanguageConfiguration);

  wgslRegistrations.add(monaco);
}

/** Register the worker-free JSON tokenizer used for shader config files. */
export function setupMonacoJson(monaco: typeof import('monaco-editor/editor/editor.api.js')) {
  if (jsonRegistrations.has(monaco)) {
    return;
  }

  if (!monaco.languages.getLanguages().some((language) => language.id === 'json')) {
    monaco.languages.register({ id: 'json', extensions: ['.json'] });
  }
  monaco.languages.setMonarchTokensProvider('json', jsonLanguageDefinition);
  monaco.languages.setLanguageConfiguration('json', jsonLanguageConfiguration);

  jsonRegistrations.add(monaco);
}
