// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { shaderStudioBuiltinUniformNames } from '@shader-studio/types';

// jsdom does not implement CSS.escape, but Monaco uses the browser API when
// creating scoped style selectors. Keep this test environment browser-faithful
// with the CSSOM "serialize an identifier" algorithm.
function cssEscape(value: string): string {
  const source = String(value);
  let result = '';

  for (let index = 0; index < source.length; index += 1) {
    const codeUnit = source.charCodeAt(index);
    const character = source[index];

    if (codeUnit === 0x0000) {
      result += '\uFFFD';
    } else if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f)
      || codeUnit === 0x007f
      || (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039)
      || (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && source.charCodeAt(0) === 0x002d)
    ) {
      result += `\\${codeUnit.toString(16)} `;
    } else if (index === 0 && source.length === 1 && codeUnit === 0x002d) {
      result += '\\-';
    } else if (
      codeUnit >= 0x0080
      || codeUnit === 0x002d
      || codeUnit === 0x005f
      || (codeUnit >= 0x0030 && codeUnit <= 0x0039)
      || (codeUnit >= 0x0041 && codeUnit <= 0x005a)
      || (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += character;
    } else {
      result += `\\${character}`;
    }
  }

  return result;
}

if (!globalThis.CSS) {
  Object.defineProperty(globalThis, 'CSS', { configurable: true, value: {} });
}

if (!globalThis.CSS.escape) {
  Object.defineProperty(globalThis.CSS, 'escape', {
    configurable: true,
    value: cssEscape,
  });
}

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
  if (!pattern?.match) {
    throw new Error(`Missing ${scope} pattern`);
  }
  return pattern.match;
}

function generalTextMatePreprocessorPattern(): GrammarPattern {
  const pattern = grammar.repository.preprocessor.patterns?.find(
    (entry) => entry.begin?.includes('define|undef'),
  );
  if (!pattern?.begin) {
    throw new Error('Missing general Slang preprocessor pattern');
  }
  return pattern;
}

function firstGroup(pattern: string): string {
  const start = pattern.indexOf('(');
  if (start < 0) {
    throw new Error(`Pattern has no group: ${pattern}`);
  }
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
        if (source[position] !== ')') {
          throw new Error(`Unterminated vocabulary group: ${source}`);
        }
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

function sorted(values: readonly string[]): string[] {
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
        for (const identifier of ['a', 'foo']) {
          cases.add(`${identifier}.${chain}`);
        }
      }
    }
  }
  return [...cases];
}

describe('Slang Monarch language', () => {
  let monaco: typeof import('monaco-editor/esm/vs/editor/editor.api.js');

  it('provides the CSSOM CSS.escape API Monaco uses in jsdom', () => {
    expect(CSS.escape('0shader')).toBe('\\30 shader');
    expect(CSS.escape('-0shader')).toBe('-\\30 shader');
    expect(CSS.escape('a b')).toBe('a\\ b');
    expect(CSS.escape('\0')).toBe('\uFFFD');
  });

  beforeAll(async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    monaco = await import('monaco-editor/esm/vs/editor/editor.api.js');
    const { setupMonacoGlsl, setupMonacoSlang } = await import('../setup');
    setupMonacoGlsl(monaco);
    setupMonacoSlang(monaco);
  }, 30_000);

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
    const uniformPattern = grammar.repository.builtins.patterns![0].match!;
    expect(uniformPattern).toContain('inputs');
    expect(sorted([...slangShadertoyUniforms, 'inputs'])).toEqual(vocabulary(uniformPattern));
    const textMatePreprocessor = new RegExp(generalTextMatePreprocessorPattern().begin!);
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
    const textMatePreprocessor = new RegExp(generalTextMatePreprocessorPattern().begin!);
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

  it('highlights the Slang language directive as a dedicated keyword', () => {
    const tokens = monaco.editor.tokenize('#language "slang" // shader language', 'slang')[0];

    expect(tokens.map(({ offset, type }) => ({ offset, type }))).toEqual([
      { offset: 0, type: 'keyword.preprocessor.language.slang' },
      { offset: 9, type: 'white.slang' },
      { offset: 10, type: 'string.slang' },
      { offset: 17, type: 'white.slang' },
      { offset: 18, type: 'comment.slang' },
    ]);
    expect(
      shaderStudioTheme.rules.find(
        (rule) => rule.token === 'keyword.preprocessor.language',
      )?.foreground,
    ).toBe('FF70FF');
  });

  it('maps representative Slang and GLSL tokens to the same overlay colours', () => {
    const colorFor = (tokenType: string): string | undefined => shaderStudioTheme.rules
      .filter((rule) => tokenType === rule.token || tokenType.startsWith(`${rule.token}.`))
      .sort((left, right) => right.token.length - left.token.length)[0]?.foreground;
    const tokenTypeFor = (source: string, language: 'glsl' | 'slang', text: string): string => {
      const tokens = monaco.editor.tokenize(source, language)[0];
      const offset = source.indexOf(text);
      const token = [...tokens].reverse().find((candidate) => candidate.offset <= offset);
      if (!token) {
        throw new Error(`Missing ${language} token for ${JSON.stringify(text)}`);
      }
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
  });

  it('highlights control flow and user functions while keeping members neutral', () => {
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
        .toBe(`variable.predefined.${language}`);
      expect.soft(tokenAt(3, 'iResolution'), `${language} iResolution`)
        .toBe(`variable.predefined.${language}`);
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

  it('colours every built-in uniform the catalog declares for the language', () => {
    for (const language of ['glsl', 'slang'] as const) {
      const names = shaderStudioBuiltinUniformNames(language);
      // Stage-limited uniforms stay coloured because a grammar has no stage.
      const highlighted = language === 'slang' ? [...names, 'inputs'] : [...names, 'iChannel7', 'iChannel12', 'iCh7', 'iCh12'];
      const otherLanguage = language === 'glsl' ? 'slang' : 'glsl';
      const plain = [
        ...shaderStudioBuiltinUniformNames(otherLanguage).filter((name) => !names.includes(name)),
        'iChannel', 'iChannelFoo', 'iChannel0Extra', 'inputsExtra', 'iTimeExtra', 'myiTime',
      ];
      if (language === 'slang') plain.push('iCh7');
      const lines = monaco.editor.tokenize([...highlighted, ...plain].join(';\n'), language);

      expect(names.length, `${language} catalog names`).toBeGreaterThan(0);
      highlighted.forEach((name, index) => {
        expect.soft(lines[index][0]?.type, `${language} ${name}`)
          .toBe(`variable.predefined.${language}`);
      });
      plain.forEach((name, index) => {
        expect.soft(lines[highlighted.length + index][0]?.type, `${language} ${name}`)
          .toBe(`identifier.${language}`);
      });
    }
  });

  it('covers the remaining GLSL theme-facing vocabulary families', () => {
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
    expect.soft(tokenAt(8, 'iChannel9'), 'iChannel9').toBe('variable.predefined.glsl');
    for (const [line, text] of [
      [5, 'main'],
      [7, 'imageStore'],
      [7, 'subgroupAdd'],
    ] as const) {
      expect.soft(tokenAt(line, text), text).toBe('support.function.glsl');
    }
  });

  it('colours Slang-native functions, uniforms, and constants by GLSL category', () => {
    const source = 'float4x4 transform; float16_t2x3 compact; '
      + 'lerp(frac(iTime), saturate(value), 0.5); '
      + 'texture.Sample(sampler, uv); null none';
    const tokens = monaco.editor.tokenize(source, 'slang')[0];
    const types = tokens.map((token) => token.type);
    const iTimeOffset = source.indexOf('iTime');
    const iTimeToken = [...tokens].reverse().find((token) => token.offset <= iTimeOffset);

    expect(types.filter((type) => type === 'type.slang')).toHaveLength(2);
    expect(types.filter((type) => type === 'support.function.slang')).toHaveLength(4);
    expect(iTimeToken?.type).toBe('variable.predefined.slang');
    expect(types.filter((type) => type === 'keyword.slang')).toHaveLength(2);
  });

  it('colours every Slang numeric family and preprocessor value as a number', () => {
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

  it('colours Slang raw strings as strings from prefix through terminator', () => {
    const tokens = monaco.editor.tokenize('R"tag(raw text)tag"', 'slang')[0];
    expect(tokens.map(({ offset, type, language }) => ({ offset, type, language })))
      .toEqual([{ offset: 0, type: 'string.slang', language: 'slang' }]);
  });

  it('keeps adjacent same-line raw strings separate', () => {
    const types = monaco.editor.tokenize(
      'R"a(first)a" float4 value; R"a(second)a"',
      'slang',
    )[0].map((token) => token.type);

    expect(types.filter((type) => type === 'string.slang')).toHaveLength(2);
    expect(types).toContain('type.slang');
    expect(types).toContain('identifier.slang');
  });

  it('emits runtime categories for attributes and malformed literals', () => {
    const types = monaco.editor.tokenize(
      '[numthreads(8, 8, 1)] 08 "unfinished',
      'slang',
    )[0].map((token) => token.type);

    expect(types).toContain('keyword.attribute.slang');
    expect(types).toContain('invalid.slang');
    expect(types).toContain('string.invalid.slang');
  });

  it('keeps multiline raw strings active until their matching delimiter', () => {
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

  it('keeps actual Monaco number ranges aligned with full-source TextMate semantics', () => {
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
        setLanguageConfiguration: vi.fn(),
      },
    };
  }

  it('registers only the Slang Monarch tokenizer once per Monaco instance', async () => {
    const monacoA = createMockMonaco();
    const monacoB = createMockMonaco();
    const { setupMonacoSlang } = await import('../setup');
    const { slangLanguageDefinition: definition } = await import('../slang-language');
    const { shaderLanguageConfiguration: configuration } = await import('../language-configuration');

    expect(setupMonacoSlang).toHaveLength(1);
    expect(setupMonacoSlang(monacoA as never)).toBeUndefined();
    expect(setupMonacoSlang(monacoA as never)).toBeUndefined();
    expect(setupMonacoSlang(monacoB as never)).toBeUndefined();

    for (const monaco of [monacoA, monacoB]) {
      expect(monaco.languages.register).toHaveBeenCalledTimes(1);
      expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'slang' });
      expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
      expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('slang', definition);
      expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
      expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith('slang', configuration);
    }
    expect((self as typeof self & { MonacoEnvironment?: unknown }).MonacoEnvironment).toBeUndefined();
  });

  it('installs the tokenizer when Slang is already registered', async () => {
    const monaco = createMockMonaco([{ id: 'slang' }]);
    const { setupMonacoSlang } = await import('../setup');
    const { slangLanguageDefinition: definition } = await import('../slang-language');
    const { shaderLanguageConfiguration: configuration } = await import('../language-configuration');

    setupMonacoSlang(monaco as never);
    setupMonacoSlang(monaco as never);

    expect(monaco.languages.register).not.toHaveBeenCalled();
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('slang', definition);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith('slang', configuration);
  });

  it('registers only the Slang tokenizer and language-configuration APIs', async () => {
    const languages: { id: string }[] = [];
    const monaco = {
      languages: {
        getLanguages: vi.fn(() => languages),
        register: vi.fn((language: { id: string }) => languages.push(language)),
        setMonarchTokensProvider: vi.fn(),
        setLanguageConfiguration: vi.fn(),
      },
    };
    const { setupMonacoSlang } = await import('../setup');
    const { slangLanguageDefinition: definition } = await import('../slang-language');
    const { shaderLanguageConfiguration: configuration } = await import('../language-configuration');

    expect(setupMonacoSlang(monaco as never)).toBeUndefined();
    expect(setupMonacoSlang(monaco as never)).toBeUndefined();

    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'slang' });
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('slang', definition);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledWith('slang', configuration);
    expect((self as typeof self & { MonacoEnvironment?: unknown }).MonacoEnvironment).toBeUndefined();
  });
});

describe('Slang package exports', () => {
  it('exports the language definition and setup function from the public entry point', async () => {
    const exports = await import('../index');
    const { slangLanguageDefinition: definition } = await import('../slang-language');
    const { shaderLanguageConfiguration: configuration } = await import('../language-configuration');

    expect(exports.slangLanguageDefinition).toBe(definition);
    expect(exports.shaderLanguageConfiguration).toBe(configuration);
    expect(exports.setupMonacoSlang).toEqual(expect.any(Function));
  });
});
