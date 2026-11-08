/// <reference path="./script-grammars.d.ts" />
import type * as Monaco from 'monaco-editor/editor/editor.api.js';
type MonacoApi = typeof Monaco;
type Grammar = { language: Monaco.languages.IMonarchLanguage; conf: Monaco.languages.LanguageConfiguration };
type GrammarLoader = () => Promise<readonly [Grammar, Grammar]>;
const loadGrammars: GrammarLoader = () => Promise.all([
  import('monaco-editor/languages/definitions/javascript/javascript.js'),
  import('monaco-editor/languages/definitions/typescript/typescript.js'),
]);
const registrations = new WeakMap<object, Promise<void>>();

/** Monaco's own JS/TS grammars, loaded without the TypeScript service worker. */
export function setupMonacoScriptLanguages(monaco: MonacoApi, load: GrammarLoader = loadGrammars): Promise<void> {
  const existing = registrations.get(monaco);
  if (existing) {
    return existing;
  }
  for (const [id, extensions] of [
    ['javascript', ['.js', '.jsx', '.mjs', '.cjs']],
    ['typescript', ['.ts', '.tsx', '.mts', '.cts']],
  ] as const) {
    if (!monaco.languages.getLanguages().some(language => language.id === id)) {
      monaco.languages.register({ id, extensions: [...extensions] });
    }
  }
  const loading = load().then(([javascript, typescript]) => {
    for (const [id, definition] of [['javascript', javascript], ['typescript', typescript]] as const) {
      monaco.languages.setMonarchTokensProvider(id, definition.language);
      monaco.languages.setLanguageConfiguration(id, definition.conf);
    }
  }).catch(error => {
    registrations.delete(monaco);
    throw error;
  });
  registrations.set(monaco, loading);
  return loading;
}
