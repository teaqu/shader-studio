/**
 * GLSL Monarch language definition for Monaco editor.
 * Provides syntax highlighting for GLSL/Shadertoy shaders.
 */
export const glslLanguageDefinition = {
  keywords: [
    'attribute', 'const', 'uniform', 'varying', 'layout',
    'centroid', 'flat', 'smooth', 'noperspective',
    'break', 'continue', 'do', 'for', 'while', 'switch', 'case', 'default',
    'if', 'else', 'in', 'out', 'inout',
    'true', 'false',
    'invariant', 'precise', 'discard', 'return',
    'struct',
    'lowp', 'mediump', 'highp', 'precision',
  ],
  types: [
    'float', 'int', 'uint', 'void', 'bool',
    'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4',
    'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
    'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
    'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4',
    'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DShadow',
    'samplerCubeShadow', 'sampler2DArray', 'sampler2DArrayShadow',
    'isampler2D', 'isampler3D', 'isamplerCube', 'isampler2DArray',
    'usampler2D', 'usampler3D', 'usamplerCube', 'usampler2DArray',
  ],
  builtins: [
    'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
    'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil', 'fract',
    'mod', 'modf', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep',
    'isnan', 'isinf',
    'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward',
    'reflect', 'refract',
    'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
    'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual',
    'equal', 'notEqual', 'any', 'all', 'not',
    'texture', 'textureSize', 'textureLod', 'textureOffset',
    'texelFetch', 'texelFetchOffset', 'textureProj', 'textureGrad',
    'dFdx', 'dFdy', 'fwidth',
    'mainImage',
  ],
  shadertoyUniforms: [
    'iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iFrameRate',
    'iChannelTime', 'iChannelResolution', 'iMouse', 'iDate', 'iSampleRate',
    'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3',
  ],
  operators: [
    '=', '>', '<', '!', '~', '?', ':',
    '==', '<=', '>=', '!=', '&&', '||', '++', '--',
    '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>',
    '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=',
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  tokenizer: {
    root: [
      [/#\s*\w+/, 'keyword.preprocessor'],
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@shadertoyUniforms': 'variable.predefined',
          '@builtins': 'support.function',
          '@types': 'type',
          '@keywords': 'keyword',
          '@default': 'identifier',
        }
      }],
      { include: '@whitespace' },
      [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
      [/0[xX][0-9a-fA-F]+[uU]?/, 'number.hex'],
      [/\d+[uU]?/, 'number'],
      [/[{}()\[\]]/, '@brackets'],
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': '',
        }
      }],
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
  },
};
