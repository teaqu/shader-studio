import { beforeEach, describe, expect, it, vi } from 'vitest';

import { slangLanguageDefinition } from '../slang-language';

describe('Slang Monarch language', () => {
  it('defines the Slang workspace grammar families', () => {
    expect(slangLanguageDefinition.keywords).toEqual(expect.arrayContaining([
      'module', 'import', 'implementing', '__include', 'interface', 'generic',
    ]));
    expect(slangLanguageDefinition.types).toEqual(expect.arrayContaining([
      'float4', 'Texture2D', 'RWStructuredBuffer', 'ParameterBlock',
    ]));

    const serialized = JSON.stringify(slangLanguageDefinition.tokenizer);
    expect(serialized).toContain('keyword.attribute');
    expect(serialized).toContain('keyword.preprocessor');
    expect(serialized).toContain('comment');
    expect(serialized).toContain('string');
    expect(serialized).toContain('number');
  });
});

describe('setupMonacoSlang', () => {
  beforeEach(() => vi.resetModules());

  it('registers Slang and all providers exactly once without registering GLSL', async () => {
    const registrations = {
      completion: vi.fn(() => ({ dispose: vi.fn() })),
      hover: vi.fn(() => ({ dispose: vi.fn() })),
      definition: vi.fn(() => ({ dispose: vi.fn() })),
      signature: vi.fn(() => ({ dispose: vi.fn() })),
      symbols: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const languages: { id: string }[] = [];
    const monaco = {
      languages: {
        getLanguages: vi.fn(() => languages),
        register: vi.fn((language: { id: string }) => languages.push(language)),
        setMonarchTokensProvider: vi.fn(),
        registerCompletionItemProvider: registrations.completion,
        registerHoverProvider: registrations.hover,
        registerDefinitionProvider: registrations.definition,
        registerSignatureHelpProvider: registrations.signature,
        registerDocumentSymbolProvider: registrations.symbols,
      },
      editor: { getModel: vi.fn(), createModel: vi.fn(), setModelMarkers: vi.fn() },
      Uri: { parse: vi.fn((value: string) => ({ toString: () => value })) },
    };
    const client = { dispose: vi.fn() };
    const { setupMonacoSlang } = await import('../setup');

    const first = setupMonacoSlang(monaco as never, client as never);
    const second = setupMonacoSlang(monaco as never, client as never);

    expect(second).toBe(first);
    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'slang' });
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('slang', slangLanguageDefinition);
    expect(Object.values(registrations).every((register) => register.mock.calls.length === 1)).toBe(true);
    expect(monaco.languages.register).not.toHaveBeenCalledWith({ id: 'glsl' });
  });
});
