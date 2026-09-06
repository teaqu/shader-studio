// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { jsonLanguageConfiguration, jsonLanguageDefinition } from '../json-language';

describe('JSON Monarch language', () => {
  let monaco: typeof import('monaco-editor/esm/vs/editor/editor.api.js');

  beforeAll(async () => {
    // jsdom ships no CSS.escape; Monaco's theme service needs one to build class names.
    vi.stubGlobal('CSS', {
      escape: (value: string) => String(value).replace(/[^\w-]/g, (character) => `\\${character}`),
    });
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    monaco = await import('monaco-editor/esm/vs/editor/editor.api.js');
    const { setupMonacoJson } = await import('../setup');
    setupMonacoJson(monaco);
  }, 30_000);

  function tokenTypes(source: string, line = 0): string[] {
    return monaco.editor.tokenize(source, 'json')[line].map((token) => token.type);
  }

  it('separates object keys from string values', () => {
    const types = tokenTypes('{ "version": "1.0" }');

    expect(types).toContain('string.key.json.json');
    expect(types).toContain('string.value.json.json');
  });

  it.each([
    ['42', 'number.json.json'],
    ['-1.5e3', 'number.json.json'],
    ['true', 'keyword.json.json'],
    ['false', 'keyword.json.json'],
    ['null', 'keyword.json.json'],
  ])('tokenizes the literal %s', (literal, expected) => {
    expect(tokenTypes(`{ "value": ${literal} }`)).toContain(expected);
  });

  it('keeps a string open across escaped quotes', () => {
    const types = tokenTypes('{ "path": "C:\\\\assets\\\\\\"noise\\".png" }');

    expect(types).toContain('string.escape.json.json');
    expect(types).not.toContain('string.invalid.json');
  });

  it('flags a string that never closes on its line', () => {
    expect(tokenTypes('{ "path": "unterminated')).toContain('string.invalid.json');
  });

  it('reports no shader syntax tokens for a shader config', () => {
    const config = JSON.stringify({ version: '1.0', passes: { Image: { inputs: {} } } }, null, 2);
    const lines = monaco.editor.tokenize(config, 'json');

    expect(lines.flat().map((token) => token.type).every((type) => type.endsWith('.json') || type === '')).toBe(true);
  });

  it('closes and surrounds JSON brackets and quotes', () => {
    expect(jsonLanguageConfiguration.brackets).toEqual([['{', '}'], ['[', ']']]);
    expect(jsonLanguageConfiguration.autoClosingPairs).toContainEqual({ open: '"', close: '"', notIn: ['string'] });
    expect(jsonLanguageDefinition.tokenPostfix).toBe('.json');
  });
});

describe('setupMonacoJson', () => {
  function createMockMonaco(languages: { id: string }[] = []) {
    return {
      languages: {
        getLanguages: vi.fn(() => languages),
        register: vi.fn((language: { id: string }) => languages.push(language)),
        setMonarchTokensProvider: vi.fn(),
        setLanguageConfiguration: vi.fn(),
      },
    };
  }

  it('registers the tokenizer once per Monaco instance', async () => {
    const { setupMonacoJson } = await import('../setup');
    const monacoA = createMockMonaco();
    const monacoB = createMockMonaco();

    setupMonacoJson(monacoA as never);
    setupMonacoJson(monacoA as never);
    setupMonacoJson(monacoB as never);

    for (const monaco of [monacoA, monacoB]) {
      expect(monaco.languages.register).toHaveBeenCalledTimes(1);
      expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'json', extensions: ['.json'] });
      expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('json', jsonLanguageDefinition);
      expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith('json', jsonLanguageConfiguration);
    }
  });

  it('installs the tokenizer when JSON is already registered', async () => {
    const { setupMonacoJson } = await import('../setup');
    const monaco = createMockMonaco([{ id: 'json' }]);

    setupMonacoJson(monaco as never);

    expect(monaco.languages.register).not.toHaveBeenCalled();
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
  });
});
