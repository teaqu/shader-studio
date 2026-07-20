import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const grammar = JSON.parse(readFileSync(
  resolve(process.cwd(), '../extension/syntaxes/slang.tmLanguage.json'),
  'utf8',
)) as {
  repository: Record<string, { match?: string; patterns?: Array<{ match: string }> }>;
};

const expected = {
  control: ['if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do', 'break', 'continue', 'return', 'discard'],
  declarations: ['module', 'import', 'implementing', 'interface', 'extension', 'struct', 'class', 'enum', 'typedef', 'typealias', 'associatedtype', 'property', 'namespace', 'using', 'generic', 'where', 'each', 'expand', 'let', 'var', 'func', 'this', 'This', 'operator'],
  modifiers: ['public', 'private', 'internal', 'static', 'const', 'uniform', 'in', 'out', 'inout', 'ref', 'groupshared', 'precise', 'nointerpolation', 'linear', 'centroid', 'sample', 'globallycoherent', 'volatile', 'extern', 'inline', 'mutating', 'nonmutating', 'differentiable', 'no_diff'],
  constants: ['true', 'false', 'null', 'none'],
  internalAttributes: ['__include', '__generic', '__intrinsic_op', '__target_intrinsic'],
  attributeKeywords: ['shader', 'numthreads', 'entryPoint', 'earlydepthstencil', 'branch', 'flatten', 'loop', 'unroll', 'fastopt', 'forcecase', 'call', 'maximallyReconverges', 'quadDerivatives'],
  preprocessor: ['language', 'define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else', 'endif', 'include', 'line', 'pragma', 'error', 'warning'],
  types: [
    'void', 'bool', 'bool2', 'bool3', 'bool4', 'half', 'half2', 'half3', 'half4',
    'float', 'float2', 'float3', 'float4', 'double', 'double2', 'double3', 'double4',
    'int', 'int2', 'int3', 'int4', 'uint', 'uint2', 'uint3', 'uint4',
    'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t', 'int64_t', 'uint64_t',
    'vector', 'matrix', 'Texture1D', 'Texture2D', 'Texture3D', 'TextureCube',
    'Texture1DArray', 'Texture2DArray', 'Texture3DArray', 'TextureCubeArray',
    'RWTexture1D', 'RWTexture2D', 'RWTexture3D', 'RWTexture1DArray', 'RWTexture2DArray', 'RWTexture3DArray',
    'SamplerState', 'SamplerComparisonState', 'Buffer', 'RWBuffer', 'StructuredBuffer',
    'RWStructuredBuffer', 'ByteAddressBuffer', 'RWByteAddressBuffer', 'ParameterBlock',
    'ConstantBuffer', 'RaytracingAccelerationStructure',
  ],
};

function matchesWhole(pattern: RegExp, value: string): boolean {
  return new RegExp(`^(?:${pattern.source})$`).test(value);
}

describe('Slang Monarch language', () => {
  it('defines the same concrete vocabulary families as the extension grammar', () => {
    expect(slangControlKeywords).toEqual(expected.control);
    expect(slangDeclarationKeywords).toEqual(expected.declarations);
    expect(slangModifiers).toEqual(expected.modifiers);
    expect(slangConstants).toEqual(expected.constants);
    expect(slangInternalAttributes).toEqual(expected.internalAttributes);
    expect(slangAttributeKeywords).toEqual(expected.attributeKeywords);
    expect(slangPreprocessorDirectives).toEqual(expected.preprocessor);
    expect(slangTypes).toEqual(expected.types);

    const keywordPatterns = grammar.repository.keywords.patterns!.map((entry) => new RegExp(entry.match));
    const attributePatterns = grammar.repository.attributes.patterns!.map((entry) => new RegExp(entry.match));
    const typePatterns = grammar.repository.types.patterns!.map((entry) => new RegExp(entry.match));

    for (const word of [...expected.control, ...expected.declarations, ...expected.modifiers, ...expected.constants]) {
      expect(keywordPatterns.some((pattern) => matchesWhole(pattern, word)), word).toBe(true);
    }
    for (const word of [...expected.internalAttributes, ...expected.attributeKeywords.map((word) => `[${word}]`)]) {
      expect(attributePatterns.some((pattern) => matchesWhole(pattern, word)), word).toBe(true);
    }
    for (const word of expected.types) {
      expect(typePatterns.some((pattern) => matchesWhole(pattern, word)), word).toBe(true);
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
});

describe('setupMonacoSlang', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (self as typeof self & { MonacoEnvironment?: unknown }).MonacoEnvironment;
  });

  it('registers only the Slang Monarch tokenizer exactly once', async () => {
    const languages: { id: string }[] = [];
    const monaco = {
      languages: {
        getLanguages: vi.fn(() => languages),
        register: vi.fn((language: { id: string }) => languages.push(language)),
        setMonarchTokensProvider: vi.fn(),
      },
    };
    const { setupMonacoSlang } = await import('../setup');

    expect(setupMonacoSlang).toHaveLength(1);
    expect(setupMonacoSlang(monaco as never)).toBeUndefined();
    expect(setupMonacoSlang(monaco as never)).toBeUndefined();

    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    expect(monaco.languages.register).toHaveBeenCalledWith({ id: 'slang' });
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledWith('slang', slangLanguageDefinition);
    expect((self as typeof self & { MonacoEnvironment?: unknown }).MonacoEnvironment).toBeUndefined();
  });
});

describe('Slang package exports', () => {
  it('exports the language definition and setup function from the public entry point', async () => {
    const exports = await import('../index');

    expect(exports.slangLanguageDefinition).toStrictEqual(slangLanguageDefinition);
    expect(exports.setupMonacoSlang).toEqual(expect.any(Function));
  });
});
