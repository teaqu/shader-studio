import type { languages } from 'monaco-editor';
import { shaderStudioBuiltinUniformNames } from '@shader-studio/types';

export const wgslControlKeywords = [
  'if', 'else', 'switch', 'case', 'default', 'for', 'while', 'loop',
  'break', 'continue', 'continuing', 'return', 'discard',
];

export const wgslDeclarationKeywords = [
  'fn', 'let', 'var', 'const', 'override', 'struct', 'alias',
  'enable', 'requires', 'diagnostic', 'const_assert',
];

export const wgslConstants = ['true', 'false'];

export const wgslAttributeKeywords = [
  'group', 'binding', 'location', 'builtin', 'vertex', 'fragment', 'compute',
  'workgroup_size', 'size', 'align', 'interpolate', 'invariant', 'must_use',
  'const', 'diagnostic', 'id',
];

export const wgslBuiltins = [
  'abs', 'acos', 'acosh', 'all', 'any', 'asin', 'asinh', 'atan', 'atanh',
  'bitcast', 'ceil', 'clamp',
  'cos', 'cosh', 'countLeadingZeros', 'countOneBits', 'countTrailingZeros',
  'cross', 'degrees', 'determinant', 'distance', 'dot', 'dot4U8Packed',
  'dot4I8Packed', 'exp', 'exp2', 'extractBits', 'faceForward', 'firstLeadingBit',
  'firstTrailingBit', 'floor', 'fma', 'fract', 'frexp', 'insertBits',
  'inverseSqrt', 'ldexp', 'length', 'log', 'log2', 'max', 'min', 'mix',
  'modf', 'normalize', 'pow', 'quantizeToF16', 'radians', 'reflect', 'refract',
  'reverseBits', 'round', 'saturate', 'select', 'sign', 'sin', 'sinh',
  'smoothstep', 'sqrt', 'step', 'tan', 'tanh', 'transpose', 'trunc',
  'dpdx', 'dpdxCoarse', 'dpdxFine', 'dpdy', 'dpdyCoarse', 'dpdyFine',
  'fwidth', 'fwidthCoarse', 'fwidthFine',
  'arrayLength', 'atomicLoad', 'atomicStore', 'atomicAdd', 'atomicSub',
  'atomicMax', 'atomicMin', 'atomicAnd', 'atomicOr', 'atomicXor',
  'atomicExchange', 'atomicCompareExchangeWeak',
  'textureSample', 'textureSampleBias', 'textureSampleLevel', 'textureSampleGrad',
  'textureSampleCompare', 'textureSampleCompareLevel', 'textureGather',
  'textureGatherCompare', 'textureLoad', 'textureStore', 'textureDimensions',
  'textureNumLayers', 'textureNumLevels', 'textureNumSamples',
  'pack4x8snorm', 'pack4x8unorm', 'pack2x16snorm', 'pack2x16unorm',
  'pack2x16float', 'unpack4x8snorm', 'unpack4x8unorm', 'unpack2x16snorm',
  'unpack2x16unorm', 'unpack2x16float',
  'storageBarrier', 'workgroupBarrier', 'textureBarrier', 'workgroupUniformLoad',
];

export const wgslShadertoyUniforms = [...shaderStudioBuiltinUniformNames('wgsl')];

export const wgslTypes = [
  'bool', 'f16', 'f32', 'i32', 'u32',
  'vec2f', 'vec2h', 'vec2i', 'vec2u', 'vec2',
  'vec3f', 'vec3h', 'vec3i', 'vec3u', 'vec3',
  'vec4f', 'vec4h', 'vec4i', 'vec4u', 'vec4',
  'mat2x2f', 'mat2x2h', 'mat2x3f', 'mat2x3h', 'mat2x4f', 'mat2x4h',
  'mat3x2f', 'mat3x2h', 'mat3x3f', 'mat3x3h', 'mat3x4f', 'mat3x4h',
  'mat4x2f', 'mat4x2h', 'mat4x3f', 'mat4x3h', 'mat4x4f', 'mat4x4h',
  'mat2x2', 'mat2x3', 'mat2x4',
  'mat3x2', 'mat3x3', 'mat3x4',
  'mat4x2', 'mat4x3', 'mat4x4',
  'atomic', 'array', 'ptr',
  'sampler', 'sampler_comparison',
  'texture_1d', 'texture_2d', 'texture_2d_array', 'texture_3d',
  'texture_cube', 'texture_cube_array', 'texture_multisampled_2d',
  'texture_storage_1d', 'texture_storage_2d', 'texture_storage_2d_array',
  'texture_storage_3d',
  'texture_depth_2d', 'texture_depth_2d_array', 'texture_depth_cube',
  'texture_depth_cube_array', 'texture_depth_multisampled_2d',
  'texture_external',
];

const decimalDigits = String.raw`\d+`;
const hexDigits = String.raw`[0-9a-fA-F]+`;
const hexFloatBody = String.raw`(?:${hexDigits}\.?${hexDigits}|${hexDigits}\.|\.${hexDigits})`;
const decimalFloatBody = String.raw`(?:${decimalDigits}\.${decimalDigits}|\.${decimalDigits}|${decimalDigits}\.)`;
const decimalExponent = String.raw`(?:[eE][+-]?${decimalDigits})`;
const binaryExponent = String.raw`(?:[pP][+-]?${decimalDigits})`;
const numberBody = [
  `0[xX]${hexFloatBody}${binaryExponent}`,
  `0[xX]${hexDigits}${binaryExponent}`,
  `0[xX]${hexDigits}[iu]?`,
  `${decimalFloatBody}${decimalExponent}?[fh]?`,
  `${decimalDigits}${decimalExponent}[fh]?`,
  `${decimalDigits}[fhiu]`,
  `${decimalDigits}`,
].join('|');

export const wgslNumberPattern = new RegExp(
  `(?<![\\w.])(?:${numberBody})(?![\\w.])`,
);
// Monarch matches each rule against the unconsumed line suffix, so it cannot
// observe the preceding character. Use a right-bounded matcher instead.
const wgslMonarchNumberPattern = new RegExp(`(?:${numberBody})(?![\\w.])`);

/** WGSL Monarch definition. WGSL has no preprocessor and no string literals. */
export const wgslLanguageDefinition: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.wgsl',
  controlKeywords: wgslControlKeywords,
  declarationKeywords: wgslDeclarationKeywords,
  constants: wgslConstants,
  attributes: wgslAttributeKeywords,
  builtins: wgslBuiltins,
  shadertoyUniforms: wgslShadertoyUniforms,
  types: wgslTypes,
  operators: [
    '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
    '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '+=',
    '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '->',
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  tokenizer: {
    root: [
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
      [/@[a-zA-Z_]\w*/, 'keyword.attribute'],
      [/\.(?:[xyzw]{1,4}|[rgba]{1,4})\b/, 'identifier'],
      [/bitcast(?=\s*<[^()\r\n]*>\s*\()/, 'support.function'],
      [/[a-zA-Z_]\w*(?=\s*\()/, {
        cases: {
          '@controlKeywords': 'keyword.control',
          '@declarationKeywords': 'keyword.declaration',
          '@constants': 'keyword',
          '@builtins': 'support.function',
          '@types': 'type',
          '@default': 'support.function',
        },
      }],
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@shadertoyUniforms': 'variable.predefined',
          '@types': 'type',
          '@constants': 'keyword',
          '@controlKeywords': 'keyword.control',
          '@declarationKeywords': 'keyword.declaration',
          '@default': 'identifier',
        },
      }],
      { include: '@whitespace' },
      [wgslMonarchNumberPattern, 'number'],
      [/[{}()\[\]]/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/[;,.]/, 'delimiter'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, 'white'],
    ],
    // Block comments nest in WGSL: @push tracks the depth, @pop unwinds it.
    comment: [
      [/\/\*/, 'comment', '@push'],
      [/\*\//, 'comment', '@pop'],
      [/[^/*]+/, 'comment'],
      [/[/*]/, 'comment'],
    ],
  },
};
