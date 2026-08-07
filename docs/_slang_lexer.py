"""Pygments lexer for Slang shader language."""

from pygments.lexer import RegexLexer, words
from pygments.token import Comment, Keyword, Name, Number, Operator, Punctuation, Whitespace

__all__ = ["SlangLexer"]


class SlangLexer(RegexLexer):
    """Lexer for the Slang GPU shading language."""

    name = "Slang"
    aliases = ["slang"]
    filenames = ["*.slang"]
    mimetypes = ["text/x-slang"]

    tokens = {
        "root": [
            (r"#(?:.*\\\n)*.*$", Comment.Preproc),
            (r"//.*$", Comment.Single),
            (r"/(\\\n)?[*](.|\n)*?[*](\\\n)?/", Comment.Multiline),
            (r"\+|-|~|!=?|\*|/|%|<<|>>|<=?|>=?|==?|&&?|\^|\|\|?", Operator),
            (r"[?:]", Operator),
            (r"\bdefined\b", Operator),
            (r"[;{}(),\[\]]", Punctuation),
            (r"[+-]?\d*\.\d+([eE][-+]?\d+)?", Number.Float),
            (r"[+-]?\d+\.\d*([eE][-+]?\d+)?", Number.Float),
            (r"0[xX][0-9a-fA-F]*", Number.Hex),
            (r"0[0-7]*", Number.Oct),
            (r"[1-9][0-9]*", Number.Integer),
            # --- Keywords ---
            (words((
                # Slang module system
                "module", "implementing", "import", "__include", "__exported",
                # Interpolation / parameter
                "no_diff", "no_diff_on", "derivative_group", "uniform",
                # Memory / layout
                "groupshared", "static", "const", "cbuffer", "tbuffer",
                "column_major", "row_major", "register", "packoffset",
                # Statements
                "break", "continue", "do", "for", "while", "switch",
                "case", "default", "if", "else", "discard", "return",
                "struct", "class", "interface", "enum", "typedef",
                "namespace", "using", "template", "typename",
                "this", "operator", "explicit", "mutable",
                "inline", "noinline", "virtual", "override",
                "public", "protected", "private",
                "extension", "property",
                "in", "out", "inout",
            ), prefix=r"\b", suffix=r"\b"), Keyword),
            (words((
                "true", "false",
            ), prefix=r"\b", suffix=r"\b"), Keyword.Constant),
            # --- Slang / HLSL vector and matrix types ---
            (words((
                # Scalars
                "void", "bool", "int", "uint", "float", "double", "half",
                "int8_t", "uint8_t", "int16_t", "uint16_t",
                "int64_t", "uint64_t",
                # Vectors
                "float2", "float3", "float4",
                "int2", "int3", "int4",
                "uint2", "uint3", "uint4",
                "bool2", "bool3", "bool4",
                "double2", "double3", "double4",
                "half2", "half3", "half4",
                # Also accept GLSL-style vector names (Slang compatibility)
                "vec2", "vec3", "vec4",
                "ivec2", "ivec3", "ivec4",
                "uvec2", "uvec3", "uvec4",
                "bvec2", "bvec3", "bvec4",
                "dvec2", "dvec3", "dvec4",
                "hvec2", "hvec3", "hvec4",
                # Matrices
                "float2x2", "float2x3", "float2x4",
                "float3x2", "float3x3", "float3x4",
                "float4x2", "float4x3", "float4x4",
                "half2x2", "half2x3", "half2x4",
                "half3x2", "half3x3", "half3x4",
                "half4x2", "half4x3", "half4x4",
                "double2x2", "double2x3", "double2x4",
                "double3x2", "double3x3", "double3x4",
                "double4x2", "double4x3", "double4x4",
                "int2x2", "int2x3", "int2x4",
                "int3x2", "int3x3", "int3x4",
                "int4x2", "int4x3", "int4x4",
                "uint2x2", "uint2x3", "uint2x4",
                "uint3x2", "uint3x3", "uint3x4",
                "uint4x2", "uint4x3", "uint4x4",
                "bool2x2", "bool2x3", "bool2x4",
                "bool3x2", "bool3x3", "bool3x4",
                "bool4x2", "bool4x3", "bool4x4",
                # Also accept GLSL-style matrix names
                "mat2", "mat3", "mat4",
                "dmat2", "dmat3", "dmat4",
                "mat2x2", "mat2x3", "mat2x4",
                "mat3x2", "mat3x3", "mat3x4",
                "mat4x2", "mat4x3", "mat4x4",
                "dmat2x2", "dmat2x3", "dmat2x4",
                "dmat3x2", "dmat3x3", "dmat3x4",
                "dmat4x2", "dmat4x3", "dmat4x4",
                # Samplers
                "SamplerState", "SamplerComparisonState",
                "sampler", "sampler1D", "sampler2D", "sampler3D", "samplerCube",
                "sampler2DShadow", "samplerCubeShadow",
                # Textures
                "Texture1D", "Texture2D", "Texture3D", "TextureCube",
                "Texture1DArray", "Texture2DArray", "TextureCubeArray",
                "Texture2DMS", "Texture2DMSArray",
                "RWTexture1D", "RWTexture2D", "RWTexture3D",
                "RWTexture1DArray", "RWTexture2DArray",
                # Buffer types
                "StructuredBuffer", "RWStructuredBuffer",
                "ByteAddressBuffer", "RWByteAddressBuffer",
                "AppendStructuredBuffer", "ConsumeStructuredBuffer",
                "Buffer", "RWBuffer",
                "ConstantBuffer", "TextureBuffer",
                # Samplers (GLSL compat)
                "sampler2DRect", "samplerBuffer",
                "isampler2D", "usampler2D",
                # Ray tracing
                "RaytracingAccelerationStructure",
                # Built-in shader objects (Slang/ShaderToy)
                "ShaderToyChannel2D", "ShaderToyChannelCube",
            ), prefix=r"\b", suffix=r"\b"), Keyword.Type),
            # --- Slang / HLSL attributes ---
            (r"\[(?:shader|numthreads|domain|earlydepthstencil|instance"
             r"|maxtessfactor|maxvertexcount|outputcontrolpoints"
             r"|outputtopology|partitioning|patchconstantfunc"
             r"|rootSignature|unroll|loop|flatten|branch"
             r"|forcecase|call|WaveSize)\s*\([^\]]*\)\]",
             Name.Decorator),
            (r"\[[A-Za-z_]\w*\]", Name.Decorator),
            # --- HLSL / Slang semantics ---
            (words((
                "SV_Position", "SV_DispatchThreadID", "SV_GroupID",
                "SV_GroupIndex", "SV_GroupThreadID", "SV_InstanceID",
                "SV_IsFrontFace", "SV_PrimitiveID", "SV_RenderTargetArrayIndex",
                "SV_SampleIndex", "SV_Target", "SV_VertexID",
                "SV_ViewportArrayIndex", "SV_OutputControlPointID",
                "SV_DomainLocation", "SV_InsideTessFactor",
                "SV_TessFactor", "SV_Coverage", "SV_Depth",
                "SV_DepthGreaterEqual", "SV_DepthLessEqual",
                "SV_StencilRef", "SV_ClipDistance", "SV_CullDistance",
                "SV_GSInstanceID",
                "POSITION", "COLOR", "TEXCOORD", "NORMAL",
                "TANGENT", "BINORMAL", "BLENDINDICES", "BLENDWEIGHT",
            ), prefix=r"\b", suffix=r"\b"), Name.Builtin),
            # --- Slang / HLSL built-in functions ---
            (words((
                # Math (Slang/HLSL names)
                "lerp", "saturate", "rcp", "rsqrt", "mad",
                "ddx", "ddy", "ddx_coarse", "ddy_coarse",
                "ddx_fine", "ddy_fine", "fwidth",
                "fmod", "frac", "atan2",
                "clamp", "step", "smoothstep",
                "sign", "abs", "min", "max",
                "floor", "ceil", "round", "trunc",
                "sqrt", "pow", "exp", "exp2", "log", "log2", "log10",
                "sin", "cos", "tan",
                "asin", "acos", "atan",
                "sinh", "cosh", "tanh",
                "radians", "degrees",
                "length", "distance", "dot", "cross",
                "normalize", "reflect", "refract", "faceforward",
                "transpose", "determinant", "mul",
                "all", "any", "none",
                "isinf", "isnan", "isfinite",
                "asfloat", "asint", "asuint",
                "asdouble", "asint64", "asuint64",
                "countbits", "firstbithigh", "firstbitlow", "reversebits",
                "modf", "frexp", "ldexp",
                "noise", "sincos",
                # Additional Slang/GLSL builtins (GLSL compat)
                "mix",
                "fract", "mod",
                "inversesqrt",
            ), prefix=r"\b", suffix=r"\b"), Name.Builtin),
            # gl_ reserved names (compatibility)
            (r"gl_\w*", Name.Builtin),
            # --- Shader entry points and generated helpers ---
            (words((
                "mainImage", "mainVertex", "mainSound",
                "sampleIChannel0", "sampleIChannel1", "sampleIChannel2",
                "sampleIChannel3", "sampleIChannel4", "sampleIChannel5",
                "sampleIChannel6", "sampleIChannel7", "sampleIChannel8",
                "sampleIChannel9", "sampleIChannel10", "sampleIChannel11",
                "sampleIChannel12", "sampleIChannel13", "sampleIChannel14",
                "sampleIChannel15",
                "writeOutput",
            ), prefix=r"\b", suffix=r"\b"), Name.Builtin),
            (r"[A-Za-z_]\w*", Name),
            (r"\.", Punctuation),
            (r"\s+", Whitespace),
        ],
    }
