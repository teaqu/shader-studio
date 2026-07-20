import type { languages } from 'monaco-editor';

// These concrete vocabularies mirror extension/syntaxes/slang.tmLanguage.json.
// The parity tests intentionally compare both surfaces to prevent editor drift.
export const slangControlKeywords = [
  'if', 'else', 'switch', 'case', 'default', 'for', 'while', 'do',
  'break', 'continue', 'return', 'discard',
];

export const slangDeclarationKeywords = [
  'module', 'import', 'implementing', 'interface', 'extension', 'struct',
  'class', 'enum', 'typedef', 'typealias', 'associatedtype', 'property',
  'namespace', 'using', 'generic', 'where', 'each', 'expand', 'let', 'var',
  'func', 'this', 'This', 'operator',
];

export const slangModifiers = [
  'public', 'private', 'internal', 'static', 'const', 'uniform', 'in', 'out',
  'inout', 'ref', 'groupshared', 'precise', 'nointerpolation', 'linear',
  'centroid', 'sample', 'globallycoherent', 'volatile', 'extern', 'inline',
  'mutating', 'nonmutating', 'differentiable', 'no_diff',
];

export const slangConstants = ['true', 'false', 'null', 'none'];

export const slangInternalAttributes = [
  '__include', '__generic', '__intrinsic_op', '__target_intrinsic',
];

export const slangAttributeKeywords = [
  'shader', 'numthreads', 'entryPoint', 'earlydepthstencil', 'branch',
  'flatten', 'loop', 'unroll', 'fastopt', 'forcecase', 'call',
  'maximallyReconverges', 'quadDerivatives',
];

export const slangPreprocessorDirectives = [
  'language', 'define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else',
  'endif', 'include', 'line', 'pragma', 'error', 'warning',
];

export const slangTypes = [
  'void', 'bool', 'bool2', 'bool3', 'bool4', 'half', 'half2', 'half3', 'half4',
  'float', 'float2', 'float3', 'float4', 'double', 'double2', 'double3', 'double4',
  'int', 'int2', 'int3', 'int4', 'uint', 'uint2', 'uint3', 'uint4',
  'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t', 'int64_t', 'uint64_t',
  'vector', 'matrix', 'Texture1D', 'Texture2D', 'Texture3D', 'TextureCube',
  'Texture1DArray', 'Texture2DArray', 'Texture3DArray', 'TextureCubeArray',
  'RWTexture1D', 'RWTexture2D', 'RWTexture3D', 'RWTexture1DArray',
  'RWTexture2DArray', 'RWTexture3DArray', 'SamplerState', 'SamplerComparisonState',
  'Buffer', 'RWBuffer', 'StructuredBuffer', 'RWStructuredBuffer',
  'ByteAddressBuffer', 'RWByteAddressBuffer', 'ParameterBlock', 'ConstantBuffer',
  'RaytracingAccelerationStructure',
];

const preprocessorAlternation = slangPreprocessorDirectives.join('|');
const attributeAlternation = slangAttributeKeywords.join('|');
const internalAttributeAlternation = slangInternalAttributes.join('|');
const identifier = '[A-Za-z_]\\w*';

export const slangPreprocessorPattern = new RegExp(
  `^\\s*#\\s*(?:${preprocessorAlternation})\\b.*$`,
);
export const slangAttributePattern = new RegExp([
  `\\[(?:${attributeAlternation})\\b[^\\]]*\\]`,
  `\\[\\[\\s*${identifier}(?:::${identifier})+(?:\\s*\\([^\\[\\]]*\\))?\\s*\\]\\]`,
  `\\b(?:${internalAttributeAlternation})\\b`,
].join('|'));

const separatedDigits = String.raw`\d(?:'?\d)*`;
const integerSuffix = '(?:[uU](?:ll?|LL?)?|(?:ll?|LL?)[uU]?)?';
const hexadecimal = `0[xX][0-9a-fA-F](?:'?[0-9a-fA-F])*${integerSuffix}`;
const binary = `0[bB][01](?:'?[01])*${integerSuffix}`;
const exponent = `[eE][+-]?${separatedDigits}`;
const decimalFloat = [
  `(?:${separatedDigits}\\.(?:${separatedDigits})?|\\.${separatedDigits})(?:${exponent})?[fFhH]?`,
  `${separatedDigits}${exponent}[fFhH]?`,
  `${separatedDigits}[fFhH]`,
].join('|');
const decimalInteger = `${separatedDigits}${integerSuffix}`;

export const slangNumberPattern = new RegExp(
  `(?:${hexadecimal}|${binary}|${decimalFloat}|${decimalInteger})(?![\\w.])`,
);
const invalidMemberNumberPattern = new RegExp(
  `${identifier}\\.${separatedDigits}(?:${exponent})?[fFhH]?(?![\\w.])`,
);
const invalidDottedNumberPattern = new RegExp(
  `(?:${separatedDigits})?\\.(?:${separatedDigits})?\\.${separatedDigits}(?:\\.${separatedDigits})*`
    + `(?:${exponent})?[fFhHuUlL]*(?![\\w.])`,
);

/** Slang Monarch definition. Kept separate from GLSL so both languages coexist. */
export const slangLanguageDefinition: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.slang',
  controlKeywords: slangControlKeywords,
  declarationKeywords: slangDeclarationKeywords,
  modifiers: slangModifiers,
  constants: slangConstants,
  types: slangTypes,
  operators: [
    '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
    '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '+=',
    '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '->',
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  tokenizer: {
    root: [
      [slangPreprocessorPattern, 'keyword.preprocessor'],
      [slangAttributePattern, 'keyword.attribute'],
      [invalidMemberNumberPattern, 'invalid'],
      [invalidDottedNumberPattern, 'invalid'],
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@types': 'type',
          '@modifiers': 'keyword.modifier',
          '@constants': 'constant.language',
          '@controlKeywords': 'keyword.control',
          '@declarationKeywords': 'keyword.declaration',
          '@default': 'identifier',
        },
      }],
      { include: '@whitespace' },
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@stringDouble'],
      [/'/, 'string', '@stringSingle'],
      [slangNumberPattern, 'number'],
      [/[{}()\[\]]/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/[;,.]/, 'delimiter'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, 'white'],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],
    comment: [
      [/[^\/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[\/*]/, 'comment'],
    ],
    stringDouble: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
    stringSingle: [
      [/[^\\']+/, 'string'],
      [/\\./, 'string.escape'],
      [/'/, 'string', '@pop'],
    ],
  },
};
