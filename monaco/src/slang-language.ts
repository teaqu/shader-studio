import type { languages } from 'monaco-editor';

/** Slang Monarch definition. Kept separate from GLSL so both languages coexist. */
export const slangLanguageDefinition: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.slang',
  keywords: [
    'module', 'import', 'implementing', '__include', 'interface', 'generic',
    'associatedtype', 'extension', 'property', 'get', 'set', 'this', 'static',
    'struct', 'class', 'enum', 'typedef', 'typealias', 'namespace', 'using',
    'public', 'private', 'internal', 'extern', 'export', 'inline', 'override',
    'const', 'let', 'var', 'in', 'out', 'inout', 'ref', 'return', 'break',
    'continue', 'discard', 'if', 'else', 'for', 'while', 'do', 'switch',
    'case', 'default', 'true', 'false', 'try', 'throw', 'catch', 'defer',
  ],
  types: [
    'void', 'bool', 'int', 'int2', 'int3', 'int4', 'uint', 'uint2', 'uint3', 'uint4',
    'half', 'half2', 'half3', 'half4', 'float', 'float2', 'float3', 'float4',
    'double', 'double2', 'double3', 'double4', 'float2x2', 'float3x3', 'float4x4',
    'vector', 'matrix', 'Texture1D', 'Texture2D', 'Texture3D', 'TextureCube',
    'RWTexture1D', 'RWTexture2D', 'RWTexture3D', 'SamplerState',
    'SamplerComparisonState', 'Buffer', 'RWBuffer', 'StructuredBuffer',
    'RWStructuredBuffer', 'ByteAddressBuffer', 'RWByteAddressBuffer',
    'ConstantBuffer', 'ParameterBlock', 'DifferentialPair',
  ],
  operators: [
    '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||',
    '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '+=',
    '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '->',
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  tokenizer: {
    root: [
      [/^\s*#\s*[a-zA-Z_]\w*(?:\s+[^\r\n]*)?/, 'keyword.preprocessor'],
      [/\[\[[^\]\r\n]+\]\]|\[[a-zA-Z_]\w*(?:\([^\]\r\n]*\))?\]/, 'keyword.attribute'],
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@types': 'type',
          '@keywords': 'keyword',
          '@default': 'identifier',
        },
      }],
      { include: '@whitespace' },
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string'],
      [/0[xX][0-9a-fA-F]+[uUlL]*/, 'number.hex'],
      [/0[bB][01]+[uUlL]*/, 'number.binary'],
      [/\d*\.\d+([eE][\-+]?\d+)?[fFhH]?/, 'number.float'],
      [/\d+([eE][\-+]?\d+)[fFhH]?/, 'number.float'],
      [/\d+[uUlLfFhH]*/, 'number'],
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
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
  },
};
