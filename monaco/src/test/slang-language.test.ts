// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  slangAttributeKeywords,
  slangAttributePattern,
  slangBuiltins,
  slangConstants,
  slangControlKeywords,
  slangDeclarationKeywords,
  slangInternalAttributes,
  slangLanguageDefinition,
  slangModifiers,
  slangNumberPattern,
  slangPreprocessorDirectives,
  slangPreprocessorPattern,
  slangShadertoyUniforms,
  slangTypes,
} from '../slang-language';
import { shaderStudioTheme } from '../glsl-theme';

interface GrammarPattern {
  name: string;
  match?: string;
  begin?: string;
}

const grammarRelativePath = '../../../extension/syntaxes/slang.tmLanguage.json';
const grammarPath = fileURLToPath(new URL(grammarRelativePath, import.meta.url));
const grammar = JSON.parse(readFileSync(grammarPath, 'utf8')) as {
  repository: Record<string, { match?: string; patterns?: GrammarPattern[] }>;
};

function findPattern(repositoryKey: string, scope: string): string {
  const pattern = grammar.repository[repositoryKey].patterns?.find((entry) => entry.name === scope);
  if (!pattern?.match) throw new Error(`Missing ${scope} pattern`);
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

interface TokenRange {
  start: number;
  end: number;
}

function regexRanges(pattern: RegExp, source: string): TokenRange[] {
  const flags = `${pattern.flags.replaceAll('g', '')}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function dottedNumberCorpus(): string[] {
  const cases = new Set([
    '1.2.3', '1.2.3f', '1.2.3UL', 'foo.5',
    '1.2.', '.5.', 'foo.5.', '1.2f.', '.5h.',
    '.5', '1.', '1.2', '1e3f', '0xFFu',
  ]);
  const segmentChains = [
    ['0', '0'],
    ['5', '6'],
    ['0', '0', '0'],
    ['5', '6', '0', '5'],
  ];

  for (const segments of segmentChains) {
    for (const suffix of ['', 'f', 'UL']) {
      for (const trailingDot of ['', '.']) {
        const chain = `${segments.join('.')}${suffix}${trailingDot}`;
        cases.add(`.${chain}`);
        cases.add(`1.${chain}`);
        for (const identifier of ['a', 'foo']) cases.add(`${identifier}.${chain}`);
      }
    }
  }
  return [...cases];
}

describe('Slang Monarch language', () => {
  it('defines the same concrete vocabulary families as the extension grammar', () => {
    expect(sorted(slangControlKeywords)).toEqual(vocabulary(findPattern('keywords', 'keyword.control.flow.slang')));
    expect(sorted(slangDeclarationKeywords)).toEqual(vocabulary(findPattern('keywords', 'keyword.declaration.slang')));
    expect(sorted(slangModifiers)).toEqual(vocabulary(findPattern('keywords', 'storage.modifier.slang')));
    expect(sorted(slangConstants)).toEqual(grammar.repository.constants.patterns!
      .flatMap((entry) => vocabulary(entry.match!))
      .sort());
    expect(sorted(slangInternalAttributes)).toEqual(vocabulary(
      grammar.repository.attributes.patterns!.find((entry) => entry.match?.includes('__include'))!.match!,
    ));
    expect(sorted(slangAttributeKeywords)).toEqual(vocabulary(
      grammar.repository.attributes.patterns!.find((entry) => entry.match?.includes('shader'))!.match!,
    ));
    expect(sorted(slangBuiltins)).toEqual(grammar.repository['builtin-functions'].patterns!
      .flatMap((entry) => vocabulary(entry.match!))
      .sort());
    expect(sorted(slangShadertoyUniforms)).toEqual(
      vocabulary(
        grammar.repository.builtins.patterns![0].match!
          .replace('[0-9]', '(?:0|1|2|3|4|5|6|7|8|9)'),
      ),
    );
    const textMatePreprocessor = new RegExp(
      grammar.repository.preprocessor.patterns![0].begin!,
    );
    for (const directive of slangPreprocessorDirectives) {
      expect(textMatePreprocessor.test(`#${directive}`), directive).toBe(true);
    }
    const textMateTypes = grammar.repository.types.patterns!.map(
      (entry) => new RegExp(entry.match!),
    );
    for (const type of slangTypes) {
      expect(
        textMateTypes.some((pattern) => matchesWhole(pattern, type)),
        `${type} must exist in the extension grammar`,
      ).toBe(true);
    }
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
    const textMatePreprocessor = new RegExp(
      grammar.repository.preprocessor.patterns![0].begin!,
    );
    const textMateAttributes = grammar.repository.attributes.patterns!.map(
      (entry) => new RegExp(entry.match!),
    );
    const preprocessors = ['#language slang 2026', '  # define VALUE 4', '#\tifdef FEATURE'];
    const attributes = [
      '[numthreads(8, 8, 1)]',
      '[[vk::binding(0, 1)]]',
      '[[cuda::device_builtin]]',
      '[[vendor::category::feature(arg)]]',
      '__target_intrinsic',
    ];

    for (const value of preprocessors) {
      expect(slangPreprocessorPattern.test(value), value).toBe(
        textMatePreprocessor.test(value),
      );
    }
    for (const value of attributes) {
      const acceptedByTextMate = textMateAttributes.some((pattern) => matchesWhole(pattern, value));
      expect(matchesWhole(slangAttributePattern, value), value).toBe(acceptedByTextMate);
    }
  });

  it('maps representative Slang and GLSL tokens to the same overlay colours', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoGlsl, setupMonacoSlang } = await import('../setup');
    setupMonacoGlsl(monaco);
    setupMonacoSlang(monaco);

    const colorFor = (tokenType: string): string | undefined => shaderStudioTheme.rules
      .filter((rule) => tokenType === rule.token || tokenType.startsWith(`${rule.token}.`))
      .sort((left, right) => right.token.length - left.token.length)[0]?.foreground;
    const tokenTypeFor = (source: string, language: 'glsl' | 'slang', text: string): string => {
      const tokens = monaco.editor.tokenize(source, language)[0];
      const offset = source.indexOf(text);
      const token = [...tokens].reverse().find((candidate) => candidate.offset <= offset);
      if (!token) throw new Error(`Missing ${language} token for ${JSON.stringify(text)}`);
      return token.type;
    };
    const parityCases = [
      ['return', 'return', 'return'],
      ['const', 'const', 'const'],
      ['true', 'true', 'true'],
      ['vec4', 'float4', 'float4'],
      ['sin(value)', 'sin(value)', 'sin'],
      ['iTime', 'iTime', 'iTime'],
      ['1.5', '1.5', '1.5'],
      ['//comment', '//comment', 'comment'],
      ['"text"', '"text"', 'text'],
      ['"\\n"', '"\\n"', '\\n'],
      ['#define', '#define', '#define'],
      ['/*comment*/', '/*comment*/', 'comment'],
      ['+', '+', '+'],
      [';', ';', ';'],
      ['shade()', 'shade()', 'shade'],
    ] as const;

    for (const [glslSource, slangSource, slangText] of parityCases) {
      const glslText = slangText === 'float4' ? 'vec4' : slangText;
      const glslType = tokenTypeFor(glslSource, 'glsl', glslText);
      const slangType = tokenTypeFor(slangSource, 'slang', slangText);
      expect(
        colorFor(slangType),
        `${slangText}: ${slangType} must match ${glslType}`,
      ).toBe(colorFor(glslType));
    }
  }, 15_000);

  it('highlights control flow and user functions while keeping members neutral', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoGlsl, setupMonacoSlang } = await import('../setup');
    setupMonacoGlsl(monaco);
    setupMonacoSlang(monaco);

    const sourceLines = [
      'float shade(float value) {',
      '  if (value > 0.0) {',
      '    for (int index = 0; index < 2; index++) {',
      '      value += shade(iTime + iResolution.xy.x + color.rgba.x + texcoord.stpq.x);',
      '    }',
      '    while (value > 1.0) { value -= 1.0; }',
      '    switch (int(value)) { case 0: break; default: continue; }',
      '  }',
      '  return value;',
      '}',
    ];
    const source = sourceLines.join('\n');
    const expectedTypes = {
      glsl: {
        control: 'keyword.glsl',
        function: 'support.function.glsl',
        identifier: 'identifier.glsl',
      },
      slang: {
        control: 'keyword.control.slang',
        function: 'support.function.slang',
        identifier: 'identifier.slang',
      },
    } as const;

    for (const language of ['glsl', 'slang'] as const) {
      const lines = monaco.editor.tokenize(source, language);
      const tokenAt = (lineIndex: number, text: string, last = false) => {
        const line = sourceLines[lineIndex];
        const offset = last ? line.lastIndexOf(text) : line.indexOf(text);
        return [...lines[lineIndex]].reverse().find((token) => token.offset <= offset)?.type;
      };

      expect.soft(tokenAt(1, 'if'), `${language} if`).toBe(expectedTypes[language].control);
      expect.soft(tokenAt(2, 'for'), `${language} for`).toBe(expectedTypes[language].control);
      expect.soft(tokenAt(5, 'while'), `${language} while`).toBe(expectedTypes[language].control);
      expect.soft(tokenAt(6, 'switch'), `${language} switch`).toBe(expectedTypes[language].control);
      expect.soft(tokenAt(0, 'shade'), `${language} function definition`)
        .toBe(expectedTypes[language].function);
      expect.soft(tokenAt(3, 'shade'), `${language} function call`)
        .toBe(expectedTypes[language].function);
      expect.soft(tokenAt(3, 'iTime'), `${language} iTime`)
        .toBe(expectedTypes[language].identifier);
      expect.soft(tokenAt(3, 'iResolution'), `${language} iResolution`)
        .toBe(expectedTypes[language].identifier);
      expect.soft(tokenAt(3, '.xy'), `${language} .xy`)
        .toBe(expectedTypes[language].identifier);
      expect.soft(tokenAt(3, '.rgba'), `${language} .rgba`)
        .toBe(expectedTypes[language].identifier);
      expect.soft(tokenAt(3, '.stpq'), `${language} .stpq`)
        .toBe(expectedTypes[language].identifier);
      expect.soft(tokenAt(3, '.x', true), `${language} .x`)
        .toBe(expectedTypes[language].identifier);
    }
  });

  it('covers the remaining GLSL theme-facing vocabulary families', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoGlsl } = await import('../setup');
    setupMonacoGlsl(monaco);

    const sourceLines = [
      'layout(std430) sample readonly buffer Data { dvec3 value; };',
      'uniform dmat4x4 transform;',
      'uniform samplerCubeArrayShadow shadowMap;',
      'uniform image2D outputImage;',
      'atomic_uint counter;',
      'void main() {',
      '  vec2 uv = gl_FragCoord.xy / iResolution.xy;',
      '  imageStore(outputImage, ivec2(uv), vec4(subgroupAdd(value.x)));',
      '  vec4 channel = texture(iChannel9, uv);',
      '}',
    ];
    const lines = monaco.editor.tokenize(sourceLines.join('\n'), 'glsl');
    const tokenAt = (lineIndex: number, text: string) => {
      const offset = sourceLines[lineIndex].indexOf(text);
      return [...lines[lineIndex]].reverse().find((token) => token.offset <= offset)?.type;
    };

    for (const [line, text] of [
      [0, 'layout'],
      [0, 'sample'],
      [0, 'readonly'],
      [0, 'buffer'],
    ] as const) {
      expect.soft(tokenAt(line, text), text).toBe('keyword.glsl');
    }
    for (const [line, text] of [
      [0, 'dvec3'],
      [1, 'dmat4x4'],
      [2, 'samplerCubeArrayShadow'],
      [3, 'image2D'],
      [4, 'atomic_uint'],
    ] as const) {
      expect.soft(tokenAt(line, text), text).toBe('type.glsl');
    }
    for (const [line, text] of [[6, 'gl_FragCoord']] as const) {
      expect.soft(tokenAt(line, text), text).toBe('variable.predefined.glsl');
    }
    expect.soft(tokenAt(8, 'iChannel9'), 'iChannel9').toBe('identifier.glsl');
    for (const [line, text] of [
      [5, 'main'],
      [7, 'imageStore'],
      [7, 'subgroupAdd'],
    ] as const) {
      expect.soft(tokenAt(line, text), text).toBe('support.function.glsl');
    }
  });

  it('colours Slang-native functions, uniforms, and constants by GLSL category', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoSlang } = await import('../setup');
    setupMonacoSlang(monaco);

    const source = 'float4x4 transform; float16_t2x3 compact; '
      + 'lerp(frac(iTime), saturate(value), 0.5); '
      + 'texture.Sample(sampler, uv); null none';
    const tokens = monaco.editor.tokenize(source, 'slang')[0];
    const types = tokens.map((token) => token.type);
    const iTimeOffset = source.indexOf('iTime');
    const iTimeToken = [...tokens].reverse().find((token) => token.offset <= iTimeOffset);

    expect(types.filter((type) => type === 'type.slang')).toHaveLength(2);
    expect(types.filter((type) => type === 'support.function.slang')).toHaveLength(4);
    expect(iTimeToken?.type).toBe('identifier.slang');
    expect(types.filter((type) => type === 'keyword.slang')).toHaveLength(2);
  });

  it('colours every Slang numeric family and preprocessor value as a number', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoSlang } = await import('../setup');
    setupMonacoSlang(monaco);

    const literals = [
      '0x1.fp3',
      '0x1#INF',
      '1.0#INF',
      '0xCAFEu',
      '0b1010',
      '0755',
      '42uz',
      '1.25hf',
    ];
    for (const literal of literals) {
      const tokens = monaco.editor.tokenize(literal, 'slang')[0];
      expect(
        tokens.map(({ offset, type, language }) => ({ offset, type, language })),
        literal,
      ).toEqual([{ offset: 0, type: 'number.slang', language: 'slang' }]);
    }

    const preprocessorTokens = monaco.editor.tokenize('#define COUNT 42', 'slang')[0];
    expect(preprocessorTokens.map((token) => token.type)).toContain('number.slang');
  });

  it('colours Slang raw strings as strings from prefix through terminator', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoSlang } = await import('../setup');
    setupMonacoSlang(monaco);

    const tokens = monaco.editor.tokenize('R"tag(raw text)tag"', 'slang')[0];
    expect(tokens.map(({ offset, type, language }) => ({ offset, type, language })))
      .toEqual([{ offset: 0, type: 'string.slang', language: 'slang' }]);
  });

  it('keeps adjacent same-line raw strings separate', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoSlang } = await import('../setup');
    setupMonacoSlang(monaco);

    const types = monaco.editor.tokenize(
      'R"a(first)a" float4 value; R"a(second)a"',
      'slang',
    )[0].map((token) => token.type);

    expect(types.filter((type) => type === 'string.slang')).toHaveLength(2);
    expect(types).toContain('type.slang');
    expect(types).toContain('identifier.slang');
  });

  it('emits runtime categories for attributes and malformed literals', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoSlang } = await import('../setup');
    setupMonacoSlang(monaco);

    const types = monaco.editor.tokenize(
      '[numthreads(8, 8, 1)] 08 "unfinished',
      'slang',
    )[0].map((token) => token.type);

    expect(types).toContain('keyword.attribute.slang');
    expect(types).toContain('invalid.slang');
    expect(types).toContain('string.invalid.slang');
  });

  it('keeps multiline raw strings active until their matching delimiter', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoSlang } = await import('../setup');
    setupMonacoSlang(monaco);

    const lines = monaco.editor.tokenize(
      'R"a.b(first line\n)other"\nthird line\n)a.b"\nfloat4 value;',
      'slang',
    );

    expect(lines.slice(0, 4).flat().map((token) => token.type))
      .toEqual(['string.slang', 'string.slang', 'string.slang', 'string.slang']);
    expect(lines[4].map((token) => token.type)).toContain('type.slang');
  });

  it('matches the extension numeric forms and rejects invalid boundaries', () => {
    const textMateNumbers = grammar.repository.numbers.patterns!.map((entry) => new RegExp(entry.match));
    const valid = [
      '0xCA\'FEu', '0X1LL', '0b1010\'0011', '0B1ul',
      '1\'000.25e-2f', '1.', '.5h', '4e+2', '42UL', '0',
    ];
    const invalid = [
      'value42', '42value', '0x', '0b102', '1.2.3', '.5foo', '0xFF.bar',
      '1.2.', '.5.', 'foo.5.', '1.2f.', '.5h.',
    ];

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

  it('keeps actual Monaco number ranges aligned with full-source TextMate semantics', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const monaco = await import('monaco-editor/esm/vs/editor/editor.api');
    const { setupMonacoSlang } = await import('../setup');
    setupMonacoSlang(monaco);

    const textMateNumbers = grammar.repository.numbers.patterns!
      .map((entry) => new RegExp(entry.match));
    const standaloneDiscrepancies: Array<{
      source: string;
      expected: TokenRange[];
      actual: TokenRange[];
    }> = [];
    const monacoDiscrepancies: Array<{
      source: string;
      expected: TokenRange[];
      actual: TokenRange[];
    }> = [];
    const invalidChainDiscrepancies: Array<{
      source: string;
      actual: TokenRange[];
    }> = [];

    for (const source of dottedNumberCorpus()) {
      const expected = regexRanges(slangNumberPattern, source);
      const textMate = textMateNumbers.flatMap((pattern) => regexRanges(pattern, source))
        .sort((a, b) => a.start - b.start);
      if (JSON.stringify(expected) !== JSON.stringify(textMate)) {
        standaloneDiscrepancies.push({ source, expected: textMate, actual: expected });
      }

      const tokens = monaco.editor.tokenize(source, 'slang')[0];
      const actual = tokens.flatMap((token, index) => token.type === 'number.slang' ? [{
        start: token.offset,
        end: tokens[index + 1]?.offset ?? source.length,
      }] : []);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        monacoDiscrepancies.push({ source, expected, actual });
      }
      if (expected.length === 0) {
        const invalidRanges = tokens.flatMap((token, index) => token.type === 'invalid.slang' ? [{
          start: token.offset,
          end: tokens[index + 1]?.offset ?? source.length,
        }] : []);
        if (JSON.stringify(invalidRanges) !== JSON.stringify([{ start: 0, end: source.length }])) {
          invalidChainDiscrepancies.push({ source, actual: invalidRanges });
        }
      }
    }

    for (const memberAccess of ['a.foo', 'foo.bar.baz']) {
      const tokenTypes = monaco.editor.tokenize(memberAccess, 'slang')[0].map((token) => token.type);
      expect(tokenTypes, memberAccess).not.toContain('invalid.slang');
    }

    const discrepancyCount = standaloneDiscrepancies.length
      + monacoDiscrepancies.length
      + invalidChainDiscrepancies.length;
    expect(
      { standaloneDiscrepancies, monacoDiscrepancies, invalidChainDiscrepancies },
      `${discrepancyCount} dotted-number range discrepancies`,
    ).toEqual({
      standaloneDiscrepancies: [],
      monacoDiscrepancies: [],
      invalidChainDiscrepancies: [],
    });
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
