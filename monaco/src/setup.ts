import { glslLanguageDefinition } from './glsl-language';
import { shaderStudioTheme, shaderStudioTransparentTheme } from './glsl-theme';
import { slangLanguageDefinition } from './slang-language';
import { SlangMonacoAdapter, type SlangMonacoClient } from './slang/SlangMonacoAdapter';

let registered = false;
const slangAdapters = new WeakMap<object, SlangMonacoAdapter>();

/**
 * Register the GLSL language, themes, and worker stub for Monaco.
 * Safe to call multiple times — only registers once.
 *
 * @param monaco - The monaco-editor module instance
 */
export function setupMonacoGlsl(monaco: typeof import('monaco-editor')) {
  if (registered) {
    return;
  }

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
          dispatchEvent() {
            return false;
          },
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

/** Register Slang independently from GLSL and bind its language-service client. */
export function setupMonacoSlang(
  monaco: typeof import('monaco-editor/esm/vs/editor/editor.api'),
  client: SlangMonacoClient,
): SlangMonacoAdapter {
  const existing = slangAdapters.get(monaco);
  if (existing) {
    return existing;
  }

  if (!monaco.languages.getLanguages().some((language) => language.id === 'slang')) {
    monaco.languages.register({ id: 'slang' });
    monaco.languages.setMonarchTokensProvider('slang', slangLanguageDefinition);
  }
  const adapter = new SlangMonacoAdapter(monaco, client);
  adapter.addProviderDisposables([
    monaco.languages.registerCompletionItemProvider('slang', adapter),
    monaco.languages.registerHoverProvider('slang', adapter),
    monaco.languages.registerDefinitionProvider('slang', adapter),
    monaco.languages.registerSignatureHelpProvider('slang', adapter),
    monaco.languages.registerDocumentSymbolProvider('slang', adapter),
  ]);
  slangAdapters.set(monaco, adapter);
  return adapter;
}
