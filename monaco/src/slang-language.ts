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

export const slangBuiltins = [
  'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'sincos',
  'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'rsqrt', 'inversesqrt',
  'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil', 'fract',
  'frac', 'mod', 'fmod', 'modf', 'min', 'max', 'clamp', 'saturate', 'mix',
  'lerp', 'step', 'smoothstep', 'isnan', 'isinf', 'fma', 'frexp', 'ldexp',
  'mad', 'rcp',
  'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward',
  'reflect', 'refract',
  'mul', 'transpose', 'determinant', 'inverse',
  'Sample', 'SampleBias', 'SampleCmp', 'SampleCmpLevelZero', 'SampleGrad',
  'SampleLevel', 'Load', 'Gather', 'GatherRed', 'GatherGreen', 'GatherBlue',
  'GatherAlpha', 'GetDimensions', 'CalculateLevelOfDetail',
  'CalculateLevelOfDetailUnclamped', 'textureSize', 'textureQueryLod',
  'textureQueryLevels', 'textureSamples', 'texture', 'textureProj',
  'textureLod', 'textureOffset', 'texelFetch', 'texelFetchOffset',
  'textureProjOffset', 'textureLodOffset', 'textureGrad',
  'textureGradOffset', 'textureGather', 'textureGatherOffset',
  'textureGatherOffsets',
  'ddx', 'ddx_coarse', 'ddx_fine', 'ddy', 'ddy_coarse', 'ddy_fine',
  'fwidth',
];

export const slangShadertoyUniforms = [
  'iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iFrameRate',
  'iChannelTime', 'iChannelResolution', 'iMouse', 'iDate', 'iSampleRate',
  'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3', 'iChannel4',
  'iChannel5', 'iChannel6', 'iChannel7', 'iChannel8', 'iChannel9',
];

const slangMatrixBases = [
  'bool', 'half', 'float', 'double', 'float16_t', 'float32_t', 'float64_t',
  'int', 'uint', 'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t',
  'uint32_t', 'int64_t', 'uint64_t',
];
const slangMatrixTypePattern = new RegExp(
  `(?:${slangMatrixBases.join('|')})[2-4]x[2-4](?!\\w)`,
);

export const slangTypes = [
  'void', 'bool', 'bool2', 'bool3', 'bool4', 'half', 'half2', 'half3', 'half4',
  'float', 'float2', 'float3', 'float4', 'double', 'double2', 'double3', 'double4',
  'int', 'int2', 'int3', 'int4', 'uint', 'uint2', 'uint3', 'uint4',
  'float16_t', 'float32_t', 'float64_t',
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
const slangMonarchPreprocessorPattern = new RegExp(
  `^\\s*#\\s*(?:${preprocessorAlternation})\\b`,
);
const slangMonarchLanguageDirectivePattern = /^(\s*)(#\s*language)\b/;
export const slangAttributePattern = new RegExp([
  `\\[(?:${attributeAlternation})\\b[^\\]]*\\]`,
  `\\[\\[\\s*${identifier}(?:::${identifier})+(?:\\s*\\([^\\[\\]]*\\))?\\s*\\]\\]`,
  `\\b(?:${internalAttributeAlternation})\\b`,
].join('|'));

const separatedDigits = String.raw`\d(?:'?\d)*`;
const separatedHexDigits = String.raw`[0-9a-fA-F](?:'?[0-9a-fA-F])*`;
const integerSuffix = '(?:[uU](?:[lL]{1,2}|[zZ])?|(?:[lL]{1,2}|[zZ])[uU]?)?';
const floatSuffix = '(?:hf|HF|fh|FH|lf|LF|fl|FL|h|H|f|F|l|L)?';
const hexadecimalFloat = [
  '0[xX](?:',
  `${separatedHexDigits}\\.(?:${separatedHexDigits})?`,
  `|\\.${separatedHexDigits}`,
  `|${separatedHexDigits}`,
  `)(?:[pP][+-]?${separatedDigits}|#INF)${floatSuffix}`,
].join('');
const hexadecimal = `0[xX]${separatedHexDigits}${integerSuffix}`;
const binary = `0[bB][01](?:'?[01])*${integerSuffix}`;
const octal = `0[0-7](?:'?[0-7])*${integerSuffix}`;
const exponent = `(?:[eE][+-]?${separatedDigits}|#INF)`;
const decimalFloat = [
  `(?:${separatedDigits}\\.(?:${separatedDigits})?|\\.${separatedDigits})(?:${exponent})?${floatSuffix}`,
  `${separatedDigits}${exponent}${floatSuffix}`,
].join('|');
const decimalInteger = `(?:0|[1-9](?:'?\\d)*)${integerSuffix}`;
const numberBody = [
  hexadecimalFloat,
  hexadecimal,
  binary,
  octal,
  decimalFloat,
  decimalInteger,
].join('|');

export const slangNumberPattern = new RegExp(
  `(?<![\\w.])(?:${numberBody})(?![\\w.#])`,
);
// Monarch matches each rule against the unconsumed line suffix, so it cannot
// observe the preceding character. Consume malformed chains first, then use a
// right-bounded valid matcher for the remaining standalone numeric forms.
const slangMonarchNumberPattern = new RegExp(`(?:${numberBody})(?![\\w.#])`);
const invalidLeadingZeroPattern = new RegExp(
  `0(?=(?:'?\\d)*[89])(?:'?\\d)+${integerSuffix}(?![\\w.#])`,
);
const invalidNumberSuffix = '[fFhHlLuUzZ]*';
const invalidIdentifierNumberChainPattern = new RegExp(
  `${identifier}(?:\\.${separatedDigits})+${invalidNumberSuffix}\\.?(?![\\w.])`,
);
const invalidDottedNumberChainPattern = new RegExp(
  `(?:(?:${separatedDigits})?\\.${separatedDigits}(?:\\.${separatedDigits})+${invalidNumberSuffix}\\.?`
    + `|(?:${separatedDigits})?\\.${separatedDigits}${invalidNumberSuffix}\\.)(?![\\w.])`,
);

/** Slang Monarch definition. Kept separate from GLSL so both languages coexist. */
export const slangLanguageDefinition: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.slang',
  controlKeywords: slangControlKeywords,
  declarationKeywords: slangDeclarationKeywords,
  modifiers: slangModifiers,
  constants: slangConstants,
  builtins: slangBuiltins,
  shadertoyUniforms: slangShadertoyUniforms,
  types: slangTypes,
  operators: [
    '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
    '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '+=',
    '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '->',
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  tokenizer: {
    root: [
      [slangMonarchLanguageDirectivePattern, ['white', 'keyword.preprocessor.language']],
      [slangMonarchPreprocessorPattern, 'keyword.preprocessor'],
      [slangAttributePattern, 'keyword.attribute'],
      [/R"([^"()\s]*)\([^\r\n]*?\)\1"/, 'string'],
      [/R"([^"()\s]*)\(/, { token: 'string', next: '@rawString.$1' }],
      [slangMatrixTypePattern, 'type'],
      [invalidLeadingZeroPattern, 'invalid'],
      [invalidIdentifierNumberChainPattern, 'invalid'],
      [invalidDottedNumberChainPattern, 'invalid'],
      [/\.(?:[xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})\b/, 'identifier'],
      [/[a-zA-Z_]\w*(?=\s*\()/, {
        cases: {
          '@controlKeywords': 'keyword.control',
          '@declarationKeywords': 'keyword.declaration',
          '@modifiers': 'keyword.modifier',
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
          '@modifiers': 'keyword.modifier',
          '@constants': 'keyword',
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
      [slangMonarchNumberPattern, 'number'],
      [/[{}()\[\]]/, '@brackets'],
      [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
      [/[;,.]/, 'delimiter'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, 'white'],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],
    rawString: [
      [/\)([^"()\s]*)"/, {
        cases: {
          '$S0==rawString.$1': { token: 'string', next: '@pop' },
          '@default': 'string',
        },
      }],
      [/[^)\r\n]+/, 'string'],
      [/\)/, 'string'],
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
