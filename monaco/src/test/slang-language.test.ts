import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

describe('Slang Monarch language', () => {
  it('defines the Slang workspace grammar families', () => {
    expect(slangControlKeywords).toEqual(expected.control);
    expect(slangDeclarationKeywords).toEqual(expected.declarations);
    expect(slangModifiers).toEqual(expected.modifiers);
    expect(slangConstants).toEqual(expected.constants);
    expect(slangInternalAttributes).toEqual(expected.internalAttributes);
    expect(slangAttributeKeywords).toEqual(expected.attributeKeywords);
    expect(slangPreprocessorDirectives).toEqual(expected.preprocessor);
    expect(slangTypes).toEqual(expected.types);

    const serialized = JSON.stringify(slangLanguageDefinition.tokenizer);
    expect(serialized).toContain('keyword.attribute');
    expect(serialized).toContain('keyword.preprocessor');
    expect(serialized).toContain('comment');
    expect(serialized).toContain('string');
    expect(serialized).toContain('number');
    expect(serialized).toContain('stringSingle');
  });

  it('keeps Monaco concrete vocabulary accepted by the TextMate grammar', () => {
    const keywordPatterns = grammar.repository.keywords.patterns!.map((entry) => new RegExp(entry.match));
    const attributePatterns = grammar.repository.attributes.patterns!.map((entry) => new RegExp(entry.match));
    const typePattern = new RegExp(grammar.repository.types.match!);
    const preprocessorPattern = new RegExp(grammar.repository.preprocessor.match!);

    for (const word of [...expected.control, ...expected.declarations, ...expected.modifiers, ...expected.constants]) {
      expect(keywordPatterns.some((pattern) => pattern.test(word)), word).toBe(true);
    }
    for (const word of [...expected.internalAttributes, ...expected.attributeKeywords.map((word) => `[${word}]`)]) {
      expect(attributePatterns.some((pattern) => pattern.test(word)), word).toBe(true);
    }
    for (const word of expected.types) {
      expect(typePattern.test(word), word).toBe(true);
    }
    for (const word of expected.preprocessor) {
      expect(preprocessorPattern.test(`#${word}`), word).toBe(true);
    }
  });

  it('matches representative TextMate preprocessor, attribute, and numeric forms', () => {
    const textMatePreprocessor = new RegExp(grammar.repository.preprocessor.match!);
    const textMateAttributes = grammar.repository.attributes.patterns!.map((entry) => new RegExp(entry.match));
    const textMateNumber = new RegExp(grammar.repository.numbers.match!);
    const cases = ['0xCA\'FEu', '0b1010\'0011', '1\'000.25e-2f', '.5h', '42UL'];

    expect(slangPreprocessorPattern.test('# language slang 2026')).toBe(textMatePreprocessor.test('# language slang 2026'));
    expect(slangAttributePattern.test('[numthreads(8, 8, 1)]')).toBe(textMateAttributes.some((pattern) => pattern.test('[numthreads(8, 8, 1)]')));
    for (const value of cases) {
      expect(slangNumberPattern.test(value), value).toBe(textMateNumber.test(value));
    }
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
