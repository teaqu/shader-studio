// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupMonacoScriptLanguages } from '../script-languages';
let monaco: typeof import('monaco-editor/editor/editor.api.js');
beforeAll(async()=>{
  vi.stubGlobal('CSS',{escape:(value:string)=>value});
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
  monaco=await import('monaco-editor/editor/editor.api.js');await setupMonacoScriptLanguages(monaco);
});
describe('script syntax highlighting',()=>{
  it.each(['javascript','typescript'])('highlights %s keywords, strings, numbers and comments',language=>{
    const tokens=monaco.editor.tokenize('export const name = "stream"; // comment\nlet count = 42;',language).flat().map(token=>token.type);
    for(const category of ['keyword','string','number','comment']){
      expect(tokens.some(type=>type.startsWith(category))).toBe(true);
    }
  });
});

it('reuses registrations and does not replace existing language identities',async()=>{
  const languages={getLanguages:()=>[{id:'javascript'},{id:'typescript'}],register:vi.fn(),setMonarchTokensProvider:vi.fn(),setLanguageConfiguration:vi.fn()};
  const api={languages} as unknown as typeof monaco;
  const first=setupMonacoScriptLanguages(api);expect(setupMonacoScriptLanguages(api)).toBe(first);await first;
  expect(languages.register).not.toHaveBeenCalled();expect(languages.setMonarchTokensProvider).toHaveBeenCalledTimes(2);
});

it('allows retry after a grammar chunk fails to load',async()=>{
  const definition={language:{tokenizer:{root:[]}},conf:{}};
  const load=vi.fn().mockRejectedValueOnce(Error('offline grammar')).mockResolvedValue([definition,definition]);
  const api={languages:{getLanguages:()=>[],register:vi.fn(),setMonarchTokensProvider:vi.fn(),setLanguageConfiguration:vi.fn()}} as unknown as typeof monaco;
  const first=setupMonacoScriptLanguages(api,load);await expect(first).rejects.toThrow('offline grammar');
  const retry=setupMonacoScriptLanguages(api,load);expect(retry).not.toBe(first);await retry;expect(load).toHaveBeenCalledTimes(2);
});
