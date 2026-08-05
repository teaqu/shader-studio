/**
 * GLSL Monarch language definition for Monaco editor.
 * Provides syntax highlighting for GLSL/Shadertoy shaders.
 */
const glslVectorTypes = ['vec', 'dvec', 'ivec', 'uvec', 'bvec']
  .flatMap((prefix) => [2, 3, 4].map((size) => `${prefix}${size}`));
const glslMatrixTypes = ['mat', 'dmat'].flatMap((prefix) => [
  ...[2, 3, 4].map((size) => `${prefix}${size}`),
  ...[2, 3, 4].flatMap((rows) => (
    [2, 3, 4].map((columns) => `${prefix}${rows}x${columns}`)
  )),
]);
const glslResourceShapes = [
  '1D', '2D', '3D', 'Cube', '2DRect', '1DArray', '2DArray', 'CubeArray',
  'Buffer', '2DMS', '2DMSArray',
];
const glslSamplerTypes = ['', 'i', 'u'].flatMap((prefix) => (
  glslResourceShapes.map((shape) => `${prefix}sampler${shape}`)
));
const glslShadowSamplerTypes = [
  'sampler1DShadow', 'sampler2DShadow', 'samplerCubeShadow',
  'sampler2DRectShadow', 'sampler1DArrayShadow', 'sampler2DArrayShadow',
  'samplerCubeArrayShadow',
];
const glslImageTypes = ['', 'i', 'u'].flatMap((prefix) => (
  glslResourceShapes.map((shape) => `${prefix}image${shape}`)
));

export const glslPredefinedVariables = [
  'gl_Position', 'gl_PointSize', 'gl_ClipDistance', 'gl_CullDistance',
  'gl_FragCoord', 'gl_FrontFacing', 'gl_PointCoord', 'gl_SampleID',
  'gl_SamplePosition', 'gl_SampleMaskIn', 'gl_SampleMask', 'gl_FragDepth',
  'gl_HelperInvocation', 'gl_Layer', 'gl_ViewportIndex', 'gl_PrimitiveID',
  'gl_InvocationID', 'gl_TessLevelOuter', 'gl_TessLevelInner', 'gl_TessCoord',
  'gl_PatchVerticesIn', 'gl_PrimitiveIDIn', 'gl_FragColor', 'gl_FragData',
  'gl_Vertex', 'gl_Normal', 'gl_Color', 'gl_SecondaryColor', 'gl_FogCoord',
  'gl_VertexID', 'gl_InstanceID',
  ...Array.from({ length: 8 }, (_, index) => `gl_MultiTexCoord${index}`),
  'gl_MaxVertexAttribs', 'gl_MaxVertexUniformVectors', 'gl_MaxVaryingVectors',
  'gl_MaxVertexOutputVectors', 'gl_MaxFragmentInputVectors',
  'gl_MaxVertexTextureImageUnits', 'gl_MaxCombinedTextureImageUnits',
  'gl_MaxTextureImageUnits', 'gl_MaxFragmentUniformVectors',
  'gl_MaxDrawBuffers', 'gl_MaxClipDistances', 'gl_MaxGeometryInputComponents',
  'gl_MaxGeometryOutputComponents', 'gl_MaxGeometryOutputVertices',
  'gl_MaxGeometryTotalOutputComponents', 'gl_MaxGeometryTextureImageUnits',
  'gl_MaxGeometryUniformComponents', 'gl_MaxTessControlInputComponents',
  'gl_MaxTessControlOutputComponents', 'gl_MaxTessControlTextureImageUnits',
  'gl_MaxTessControlUniformComponents', 'gl_MaxTessControlTotalOutputComponents',
  'gl_MaxTessEvaluationInputComponents', 'gl_MaxTessEvaluationOutputComponents',
  'gl_MaxTessEvaluationTextureImageUnits', 'gl_MaxTessEvaluationUniformComponents',
  'gl_MaxTessPatchComponents', 'gl_MaxPatchVertices', 'gl_MaxTessGenLevel',
  'gl_MaxComputeWorkGroupCount', 'gl_MaxComputeWorkGroupSize',
  'gl_MaxComputeUniformComponents', 'gl_MaxComputeTextureImageUnits',
  'gl_MaxComputeImageUniforms', 'gl_MaxComputeAtomicCounters',
  'gl_MaxComputeAtomicCounterBuffers', 'gl_MinProgramTexelOffset',
  'gl_MaxProgramTexelOffset', 'gl_NumWorkGroups', 'gl_WorkGroupSize',
  'gl_WorkGroupID', 'gl_LocalInvocationID', 'gl_GlobalInvocationID',
  'gl_LocalInvocationIndex',
];

export const glslLanguageDefinition = {
  keywords: [
    'attribute', 'const', 'uniform', 'varying', 'layout',
    'centroid', 'sample', 'flat', 'smooth', 'noperspective',
    'break', 'continue', 'do', 'for', 'while', 'switch', 'case', 'default',
    'if', 'else', 'in', 'out', 'inout',
    'true', 'false',
    'invariant', 'precise', 'discard', 'return',
    'struct', 'subroutine',
    'lowp', 'mediump', 'highp', 'precision',
    'buffer', 'shared', 'patch', 'coherent', 'volatile', 'restrict',
    'readonly', 'writeonly',
  ],
  types: [
    'float', 'double', 'int', 'uint', 'void', 'bool', 'atomic_uint',
    ...glslVectorTypes,
    ...glslMatrixTypes,
    ...glslSamplerTypes,
    ...glslShadowSamplerTypes,
    ...glslImageTypes,
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
    'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3', 'iChannel4',
    'iChannel5', 'iChannel6', 'iChannel7', 'iChannel8', 'iChannel9',
  ],
  predefinedVariables: glslPredefinedVariables,
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
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@stringDouble'],
      [/'/, 'string', '@stringSingle'],
      [/\.(?:[xyzw]{1,4}|[rgba]{1,4}|[stpq]{1,4})\b/, 'identifier'],
      [/[a-zA-Z_]\w*(?=\s*\()/, {
        cases: {
          '@keywords': 'keyword',
          '@types': 'type',
          '@builtins': 'support.function',
          '@default': 'support.function',
        },
      }],
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@shadertoyUniforms': 'identifier',
          '@predefinedVariables': 'variable.predefined',
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
    comment: [
      [/[^\/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[\/*]/, 'comment'],
    ],
  },
};
