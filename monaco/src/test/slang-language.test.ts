// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  slangAttributeKeywords,
  slangAttributePattern,
  slangConstants,
  slangControlKeywords,
  slangDeclarationKeywords,
  slangInternalAttributes,
  slangLanguageDefinition,
  slangModifiers,
  slangNumberPattern,
  slangPreprocessorDirectives,
  slangPreprocessorPattern,
  slangTypes,
} from '../slang-language';

interface GrammarPattern {
  name: string;
  match: string;
}

const grammarRelativePath = '../../../extension/syntaxes/slang.tmLanguage.json';
const grammarPath = fileURLToPath(new URL(grammarRelativePath, import.meta.url));
const grammar = JSON.parse(readFileSync(grammarPath, 'utf8')) as {
  repository: Record<string, { match?: string; patterns?: GrammarPattern[] }>;
};

function findPattern(repositoryKey: string, scope: string): string {
  const pattern = grammar.repository[repositoryKey].patterns?.find((entry) => entry.name === scope);
  if (!pattern) throw new Error(`Missing ${scope} pattern`);
  return pattern.match;
}

function firstGroup(pattern: string): string {
  const start = pattern.indexOf('(');
  if (start < 0) throw new Error(`Pattern has no group: ${pattern}`);
  const contentStart = pattern.startsWith('(?:', start) ? start + 3 : start + 1;
  let depth = 1;

  for (let index = contentStart; index < pattern.length; index += 1) {
    if (pattern[index] === '\\') {
      index += 1;
    } else if (pattern[index] === '(') {
      depth += 1;
    } else if (pattern[index] === ')' && --depth === 0) {
      return pattern.slice(contentStart, index);
    }
  }
  throw new Error(`Pattern has an unterminated group: ${pattern}`);
}

function expandVocabulary(source: string): string[] {
  let position = 0;

  function expression(): string[] {
    const alternatives: string[] = [];
    let sequences = [''];
    while (position < source.length && source[position] !== ')') {
      if (source[position] === '|') {
        alternatives.push(...sequences);
        sequences = [''];
        position += 1;
        continue;
      }

      let atoms: string[];
      if (source[position] === '(') {
        position += source.startsWith('?:', position + 1) ? 3 : 1;
        atoms = expression();
        if (source[position] !== ')') throw new Error(`Unterminated vocabulary group: ${source}`);
        position += 1;
      } else {
        atoms = [source[position]];
        position += 1;
      }

      if (source[position] === '?') {
        atoms = ['', ...atoms];
        position += 1;
      }
      sequences = sequences.flatMap((prefix) => atoms.map((atom) => prefix + atom));
    }
    return [...alternatives, ...sequences];
  }

  return expression();
}

function vocabulary(pattern: string): string[] {
  return expandVocabulary(firstGroup(pattern)).sort();
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

function matchesWhole(pattern: RegExp, value: string): boolean {
  return new RegExp(`^(?:${pattern.source})$`).test(value);
}

describe('Slang Monarch language', () => {
  it('defines the same concrete vocabulary families as the extension grammar', () => {
    expect(sorted(slangControlKeywords)).toEqual(vocabulary(findPattern('keywords', 'keyword.control.slang')));
    expect(sorted(slangDeclarationKeywords)).toEqual(vocabulary(findPattern('keywords', 'keyword.declaration.slang')));
    expect(sorted(slangModifiers)).toEqual(vocabulary(findPattern('keywords', 'storage.modifier.slang')));
    expect(sorted(slangConstants)).toEqual(vocabulary(findPattern('keywords', 'constant.language.slang')));
    expect(sorted(slangInternalAttributes)).toEqual(vocabulary(
      grammar.repository.attributes.patterns!.find((entry) => entry.match.includes('__include'))!.match,
    ));
    expect(sorted(slangAttributeKeywords)).toEqual(vocabulary(
      grammar.repository.attributes.patterns!.find((entry) => entry.match.includes('shader'))!.match,
    ));
    expect(sorted(slangPreprocessorDirectives)).toEqual(vocabulary(grammar.repository.preprocessor.match!));
    expect(sorted(slangTypes)).toEqual(grammar.repository.types.patterns!
      .flatMap((entry) => vocabulary(entry.match))
      .sort());
  });

  it('represents comments, strings, types, keywords, and both quote styles', () => {
    const serialized = JSON.stringify(slangLanguageDefinition.tokenizer);

    expect(serialized).toContain('keyword.control');
    expect(serialized).toContain('keyword.declaration');
    expect(serialized).toContain('keyword.modifier');
    expect(serialized).toContain('type');
    expect(serialized).toContain('comment');
    expect(serialized).toContain('string');
    expect(serialized).toContain('stringDouble');
    expect(serialized).toContain('stringSingle');
  });

  it('matches representative preprocessors and attributes accepted by the extension grammar', () => {
    const textMatePreprocessor = new RegExp(grammar.repository.preprocessor.match!);
    const textMateAttributes = grammar.repository.attributes.patterns!.map((entry) => new RegExp(entry.match));
    const preprocessors = ['#language slang 2026', '  # define VALUE 4', '#\tifdef FEATURE'];
    const attributes = [
      '[numthreads(8, 8, 1)]',
      '[[vk::binding(0, 1)]]',
      '[[cuda::device_builtin]]',
      '[[vendor::category::feature(arg)]]',
      '__target_intrinsic',
    ];

    for (const value of preprocessors) {
      expect(matchesWhole(slangPreprocessorPattern, value), value).toBe(matchesWhole(textMatePreprocessor, value));
    }
    for (const value of attributes) {
      const acceptedByTextMate = textMateAttributes.some((pattern) => matchesWhole(pattern, value));
      expect(matchesWhole(slangAttributePattern, value), value).toBe(acceptedByTextMate);
    }
  });

  it('matches the extension numeric forms and rejects invalid boundaries', () => {
    const textMateNumbers = grammar.repository.numbers.patterns!.map((entry) => new RegExp(entry.match));
    const valid = [
      '0xCA\'FEu', '0X1LL', '0b1010\'0011', '0B1ul',
      '1\'000.25e-2f', '1.', '.5h', '4e+2', '42UL', '0',
    ];
    const invalid = ['value42', '42value', '0x', '0b102', '1.2.3', '.5foo', '0xFF.bar'];

    for (const value of valid) {
      const acceptedByTextMate = textMateNumbers.some((pattern) => matchesWhole(pattern, value));
      expect(acceptedByTextMate, `TextMate: ${value}`).toBe(true);
      expect(matchesWhole(slangNumberPattern, value), `Monaco: ${value}`).toBe(true);
    }
    for (const value of invalid) {
      const acceptedByTextMate = textMateNumbers.some((pattern) => matchesWhole(pattern, value));
      expect(acceptedByTextMate, `TextMate: ${value}`).toBe(false);
      expect(matchesWhole(slangNumberPattern, value), `Monaco: ${value}`).toBe(false);
    }
  });

  it('uses Monaco tokenization to reject combined invalid numbers without rejecting valid forms', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoSlang } = await import('../setup');
    setupMonacoSlang(monaco);

    const tokenTypes = (source: string) => monaco.editor.tokenize(source, 'slang')[0]
      .map((token) => token.type);

    for (const invalid of ['1.2.3', '1.2.3f', '1.2.3UL', 'foo.5']) {
      expect(tokenTypes(invalid), invalid).not.toContain('number.slang');
    }
    for (const valid of ['.5', '1.', '42UL', '0xCA\'FEu', '1\'000.25e-2f']) {
      expect(tokenTypes(valid), valid).toContain('number.slang');
    }
  });
});

describe('setupMonacoSlang', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (self as typeof self & { MonacoEnvironment?: unknown }).MonacoEnvironment;
  });

  function createMockMonaco(initialLanguages: { id: string }[] = []) {
    const languages = [...initialLanguages];
    return {
      languages: {
        getLanguages: vi.fn(() => languages),
        register: vi.fn((language: { id: string }) => languages.push(language)),
        setMonarchTokensProvider: vi.fn(),
      },
    };
  }

  it('registers only the Slang Monarch tokenizer once per Monaco instance', async () => {
    const monacoA = createMockMonaco();
    const monacoB = createMockMonaco();
    const { setupMonacoSlang } = await import('../setup');
    const { slangLanguageDefinition: definition } = await import('../slang-language');

    expect(setupMonacoSlang).toHaveLength(1);
    expect(setupMonacoSlang(monacoA as never)).toBeUndefined();
    expect(setupMonacoSlang(monacoA as never)).toBeUndefined();
    expect(setupMonacoSlang(monacoB as never)).toBeUndefined();

    for (const monaco of [monacoA, monacoB]) {
      expect(monaco.languages.register).toHaveBeenCalledTimes(1);
      expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'slang' });
      expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
      expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('slang', definition);
    }
    expect((self as typeof self & { MonacoEnvironment?: unknown }).MonacoEnvironment).toBeUndefined();
  });

  it('installs the tokenizer when Slang is already registered', async () => {
    const monaco = createMockMonaco([{ id: 'slang' }]);
    const { setupMonacoSlang } = await import('../setup');
    const { slangLanguageDefinition: definition } = await import('../slang-language');

    setupMonacoSlang(monaco as never);
    setupMonacoSlang(monaco as never);

    expect(monaco.languages.register).not.toHaveBeenCalled();
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('slang', definition);
  });

  it('registers only the Slang Monarch tokenizer API', async () => {
    const languages: { id: string }[] = [];
    const monaco = {
      languages: {
        getLanguages: vi.fn(() => languages),
        register: vi.fn((language: { id: string }) => languages.push(language)),
        setMonarchTokensProvider: vi.fn(),
      },
    };
    const { setupMonacoSlang } = await import('../setup');
    const { slangLanguageDefinition: definition } = await import('../slang-language');

    expect(setupMonacoSlang(monaco as never)).toBeUndefined();
    expect(setupMonacoSlang(monaco as never)).toBeUndefined();

    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'slang' });
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('slang', definition);
    expect((self as typeof self & { MonacoEnvironment?: unknown }).MonacoEnvironment).toBeUndefined();
  });
});

describe('Slang package exports', () => {
  it('exports the language definition and setup function from the public entry point', async () => {
    const exports = await import('../index');
    const { slangLanguageDefinition: definition } = await import('../slang-language');

    expect(exports.slangLanguageDefinition).toBe(definition);
    expect(exports.setupMonacoSlang).toEqual(expect.any(Function));
  });
});
