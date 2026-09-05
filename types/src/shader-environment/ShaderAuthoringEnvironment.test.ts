import { describe, expect, it } from "vitest";
import {
  buildGlslAuthoringPreamble,
  buildSlangAuthoringModule,
  buildSlangRuntimePrelude,
  deriveSlangChannelGeneratedIdentifiers,
  GLSL_STABLE_DECLARATION_LINES,
  SHADER_STUDIO_BUILTIN_UNIFORMS,
  SHADER_STUDIO_SYMBOL_DOCS,
  validateShaderAuthoringEnvironment,
  type AuthoringResource,
  type AuthoringValueType,
  type ShaderAuthoringEnvironment,
} from "../index";

function baseEnvironment(languageId: "glsl" | "slang"): ShaderAuthoringEnvironment {
  return {
    documentUri: `file:///shaders/image.${languageId}`,
    languageId,
    generation: 7,
    passName: "Image",
    stage: "fragment",
    customUniforms: [],
    resources: [],
    virtualFiles: [],
  };
}

function environmentWithCustomUniformAndCubeChannel(): ShaderAuthoringEnvironment {
  return {
    ...baseEnvironment("glsl"),
    customUniforms: [{ name: "tint", type: "vec3" }],
    resources: [{ name: "sky", kind: "texture-cube" }],
  };
}

describe("ShaderAuthoringEnvironment", () => {
  it("generates the same GLSL built-ins exposed by the renderer", () => {
    const generated = buildGlslAuthoringPreamble(baseEnvironment("glsl"));
    const slang = buildSlangAuthoringModule(baseEnvironment("slang"));

    for (const line of GLSL_STABLE_DECLARATION_LINES) {
      expect(generated.text).toContain(line);
    }
    for (const line of [
      "uniform sampler2D iChannel0;",
      "uniform sampler2D iChannel1;",
      "uniform sampler2D iChannel2;",
      "uniform sampler2D iChannel3;",
      "uniform vec3 iChannelResolution[4];",
    ]) {
      expect(generated.text).toContain(line);
    }
    expect(generated.uri).toBe("file:///shaders/image.glsl");
    expect(generated.generatedLineCount).toBe(generated.text.split("\n").length);
    expect(slang.text).toContain("struct ShaderStudioInputs");
    expect(slang.text).toContain("static ShaderStudioInputs inputs;");
    expect(slang.text).not.toContain("sampleIChannel");
    expect(slang.text).not.toContain("iChannelResolution");
  });

  it("shares fragment-context declarations and documentation across both authoring languages", () => {
    const glsl = buildGlslAuthoringPreamble(baseEnvironment("glsl")).text;
    const slang = buildSlangAuthoringModule(baseEnvironment("slang")).text;
    const expected = [
      ["iWorldPosition", "vec3", "float3"],
      ["iNormal", "vec3", "float3"],
      ["iCameraPosition", "vec3", "float3"],
    ] as const;

    for (const [name, glslType, slangType] of expected) {
      const builtin = SHADER_STUDIO_BUILTIN_UNIFORMS.find((entry) => entry.name === name);
      expect(builtin).toMatchObject({
        name,
        glslType,
        slangType,
        languages: ["glsl", "slang"],
        stages: ["fragment"],
      });
      expect(glsl).toContain(`${glslType} ${name};`);
      expect(slang).toContain(`${slangType} ${name};`);
      expect(SHADER_STUDIO_SYMBOL_DOCS.find((entry) => entry.name === name)).toMatchObject({
        name,
        glslType,
        slangType,
        languages: ["glsl", "slang"],
        stages: ["fragment"],
      });
    }
  });

  it("limits renderer fragment-context authoring declarations to the fragment stage", () => {
    const glslVertex = buildGlslAuthoringPreamble({
      ...baseEnvironment("glsl"),
      stage: "vertex",
    }).text;
    const slangCompute = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      stage: "compute",
    }).text;

    for (const name of ["iWorldPosition", "iNormal", "iCameraPosition"]) {
      expect(glslVertex).not.toContain(`vec3 ${name};`);
      expect(slangCompute).not.toContain(`float3 ${name};`);
    }
  });

  it("describes custom uniforms and resources in both languages", () => {
    const environment = environmentWithCustomUniformAndCubeChannel();

    expect(buildGlslAuthoringPreamble(environment).text).toContain("uniform vec3 tint;");
    expect(buildGlslAuthoringPreamble(environment).text).toContain("uniform samplerCube sky;");
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain("float3 tint");
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain("ShaderStudioChannelCube sky");
  });

  it("models Slang inputs as named members with implementation-only bindings", () => {
    const environment = {
      ...baseEnvironment("glsl"),
      resources: [
        { name: "sky", kind: "texture-cube" as const },
        { name: "noise", kind: "texture-2d" as const },
        { name: "volume", kind: "texture-3d" as const },
        { name: "albedo", kind: "texture-2d" as const },
        { name: "detail", kind: "texture-2d" as const },
      ],
    };
    const glsl = buildGlslAuthoringPreamble(environment);
    const slang = buildSlangAuthoringModule({ ...environment, languageId: "slang" });

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    expect(glsl.text).toContain("uniform samplerCube iChannel0;");
    expect(glsl.text).toContain("uniform samplerCube sky;");
    expect(glsl.text).toContain("uniform sampler2D iChannel4;");
    expect(glsl.text).toContain("uniform sampler2D detail;");
    expect(glsl.text).toContain("uniform sampler2D iChannel4;");
    expect(glsl.text).toContain("uniform vec3 iChannelResolution[5];");
    expect(glsl.text).toContain("} iCh0;");
    expect(glsl.text).toContain("} iCh4;");
    expect(glsl.text).toContain("  samplerCube sampler;");
    expect(slang.text).toContain("struct ShaderStudioInputs");
    expect(slang.text).toContain("ShaderStudioChannelCube sky");
    expect(slang.text).toContain("ShaderStudioChannel2D noise");
    expect(slang.text).toContain("ShaderStudioChannel3D volume");
    expect(slang.text).toContain("TextureCube<float4> _ssTexture0;");
    expect(slang.text).toContain("SamplerState _ssSampler0;");
    expect(slang.text).toContain("float4 Sample(float3 dir)");
    expect(slang.text).not.toContain("sampleIChannel");
    expect(slang.text).not.toContain("iCh0");
  });

  it("keeps numeric-looking GLSL channel aliases distinct from canonical slot names", () => {
    const environment = {
      ...baseEnvironment("glsl"),
      resources: [
        { name: "iChannel01", kind: "texture-cube" as const },
        { name: "iChannel1", kind: "texture-2d" as const },
      ],
    };
    const generated = buildGlslAuthoringPreamble(environment);

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    expect(generated.text).toContain("uniform samplerCube iChannel0;");
    expect(generated.text).toContain("uniform samplerCube iChannel01;");
    expect(generated.text).toContain("uniform sampler2D iChannel1;");
  });

  it("accepts GLSL canonical channel resource names at their matching slots", () => {
    const environment = {
      ...baseEnvironment("glsl"),
      resources: [
        { name: "iChannel0", kind: "texture-2d" as const, slot: 0 },
        { name: "iChannel1", kind: "texture-cube" as const, slot: 1 },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it("reports duplicate and pathological explicit channel slots", () => {
    const environment = {
      ...baseEnvironment("glsl"),
      resources: [
        { name: "sky", kind: "texture-cube" as const, slot: 1 },
        { name: "noise", kind: "texture-2d" as const, slot: 1 },
        { name: "tooFar", kind: "texture-2d" as const, slot: 1024 },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "duplicate-channel-slot",
      message: 'Resource "noise" duplicates channel slot 1.',
    });
    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "invalid-channel-slot",
      message: 'Resource "tooFar" has an invalid channel slot.',
    });
  });

  it("rejects canonical channel aliases that conflict with their resolved slot", () => {
    const environment = {
      ...baseEnvironment("glsl"),
      resources: [{ name: "iChannel1", kind: "texture-2d" as const, slot: 0 }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "channel-alias-collision",
      message: 'Resource "iChannel1" conflicts with canonical channel slot 1.',
    });
  });

  it.each([
    ["float", "float", "float", "float", "#define value (_st.custom_value)"],
    ["vec2", "vec2", "float2", "float2", "#define value (_st.custom_value)"],
    ["vec3", "vec3", "float3", "float3", "#define value (_st.custom_value)"],
    ["vec4", "vec4", "float4", "float4", "#define value (_st.custom_value)"],
    ["bool", "bool", "bool", "int", "#define value (_st.custom_value != 0)"],
  ] as const)(
    "keeps the renderer-backed %s uniform type in GLSL, Slang authoring, and Slang runtime",
    (type, glslType, slangType, slangRuntimeType, slangAlias) => {
      const environment = {
        ...baseEnvironment("glsl"),
        customUniforms: [{ name: "value", type: type as AuthoringValueType }],
      };

      expect(buildGlslAuthoringPreamble(environment).text).toContain(`uniform ${glslType} value;`);
      expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain(`${slangType} value;`);
      const runtime = buildSlangRuntimePrelude(environment.customUniforms);
      expect(runtime).toContain(`    ${slangRuntimeType} custom_value;`);
      expect(runtime).toContain(slangAlias);
    });

  it.each(["int", "toString", "__proto__", "constructor"])(
    "does not generate declarations for unsupported custom-uniform metadata type %s",
    (type) => {
      const environment = {
        ...baseEnvironment("glsl"),
        customUniforms: [{ name: "mode", type }],
      } as unknown as ShaderAuthoringEnvironment;

      expect(buildGlslAuthoringPreamble(environment).text).not.toContain(" mode;");
      expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).not.toContain(" mode;");
      expect(buildSlangRuntimePrelude(environment.customUniforms)).not.toContain("custom_mode");
    },
  );

  it.each([
    ["texture-2d", "uniform sampler2D resource;", "ShaderStudioChannel2D resource"],
    ["texture-cube", "uniform samplerCube resource;", "ShaderStudioChannelCube resource"],
    ["texture-3d", "uniform sampler3D resource;", "ShaderStudioChannel3D resource"],
    ["storage", "uniform sampler2D resource;", "StructuredBuffer<float4> resource;"],
  ] as const)("generates the %s resource kind with its fallback element type", (kind, glslDeclaration, slangDeclaration) => {
    const resources: readonly AuthoringResource[] = [{ name: "resource", kind }];
    const environment = { ...baseEnvironment("glsl"), resources };

    expect(buildGlslAuthoringPreamble(environment).text).toContain(glslDeclaration);
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain(slangDeclaration);
  });

  it("uses a storage resource element type when one is supplied", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "particles", kind: "storage", elementType: "Particle" }],
    };

    expect(buildSlangAuthoringModule(environment).text).toContain("StructuredBuffer<Particle> particles;");
  });

  it.each(["float", "int", "uint", "Atomic<int>", "Atomic<uint>"])("accepts the renderer storage element type %s", (elementType) => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "values", kind: "storage" as const, elementType }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it("matches stage-specific Slang storage declarations and render atomic normalisation", () => {
    const compute = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      stage: "compute",
      resources: [{ name: "particles", kind: "storage", elementType: "Particle" }],
    });
    const render = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      resources: [{ name: "counters", kind: "storage", elementType: "Atomic<uint>" }],
    });

    expect(compute.text).toContain("RWStructuredBuffer<Particle> particles;");
    expect(render.text).toContain("StructuredBuffer<uint> counters;");
  });

  it("allows iChannel names as Slang input members but reserves inputs for storage", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "inputs", kind: "storage" as const, elementType: "float4" }],
    };
    const glsl = buildGlslAuthoringPreamble({ ...environment, languageId: "glsl" });
    const slang = buildSlangAuthoringModule(environment);

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: 'Resource "inputs" conflicts with a Shader Studio built-in.',
    });
    expect(glsl.text.match(/uniform sampler2D iChannel0;/g)).toHaveLength(1);
    expect(slang.text).toContain("StructuredBuffer<float4> inputs;");
  });

  it("permits an input named inputs as a member of the inputs object", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "inputs", kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    expect(buildSlangAuthoringModule(environment).text).toContain("ShaderStudioChannel2D inputs");
  });

  it("keeps iChannel names exact rather than translating them to aliases", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [
        { name: "iChannel0", kind: "texture-2d" as const },
        { name: "channel0", kind: "texture-2d" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    const source = buildSlangAuthoringModule(environment).text;
    expect(source).toContain("ShaderStudioChannel2D iChannel0");
    expect(source).toContain("ShaderStudioChannel2D channel0");
  });

  it("exposes compute sampling through the named input object", () => {
    const compute = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      stage: "compute",
      resources: [{ name: "iChannel0", kind: "texture-cube" }],
    });

    expect(compute.text).toContain("ShaderStudioChannelCube iChannel0");
    expect(compute.text).toContain("float4 SampleLevel(float3 dir, float lod)");
    expect(compute.text).not.toContain("sampleIChannel0");
  });

  it("models the renderer writeOutput helper for single and layered compute outputs", () => {
    const single = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      stage: "compute",
      outputLayers: 1,
    }).text;
    const layered = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      stage: "compute",
      outputLayers: 2,
    }).text;

    expect(single).toContain("void writeOutput(uint2 coord, float4 color)");
    expect(single).not.toContain("void writeOutput(uint2 coord, uint layer, float4 color)");
    expect(layered).toContain("void writeOutput(uint2 coord, uint layer, float4 color)");
    expect(layered).not.toContain("void writeOutput(uint2 coord, float4 color)");
  });

  it("exposes the renderer compute repetition index only to compute authoring", () => {
    const compute = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      stage: "compute",
    }).text;
    const fragment = buildSlangAuthoringModule(baseEnvironment("slang")).text;

    expect(compute).toContain("int iDispatch;");
    expect(fragment).not.toContain("iDispatch");
    expect(SHADER_STUDIO_SYMBOL_DOCS.find((entry) => entry.name === "iDispatch")).toMatchObject({
      slangType: "int",
      languages: ["slang"],
      stages: ["compute"],
    });
  });

  it.each([
    "sampleIChannel0",
    "sampleIChannel0Vertex",
    "sampleSky",
    "sampleSkyVertex",
  ])("allows custom uniforms previously blocked by generated Slang helpers: %s", (name) => {
    const environment = {
      ...baseEnvironment("slang"),
      customUniforms: [{ name, type: "float" as const }],
      resources: [{ name: "sky", kind: "texture-cube" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it("allows an input named after a removed canonical helper", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "sampleIChannel0", kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it("allows inputs which differed only by case", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [
        { name: "sky", kind: "texture-cube" as const },
        { name: "Sky", kind: "texture-cube" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each([
    ["skySampler", "skySampler"],
    ["_getICh0", "_getICh0"],
    ["ShaderToySampler2D", "ShaderToySampler2D"],
  ])("allows %s after removing generated identifier %s", (name) => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [
        { name: "sky", kind: "texture-2d" as const },
        { name, kind: "texture-2d" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it("accepts canonical channels and non-colliding normal aliases", () => {
    const environment = {
      ...baseEnvironment("slang"),
      customUniforms: [{ name: "tint", type: "vec3" as const }],
      resources: [
        { name: "iChannel0", kind: "texture-cube" as const },
        { name: "noise", kind: "texture-2d" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it("reports an empty Slang resource name without throwing during generated-name validation", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "", kind: "texture-2d" as const }],
    };

    expect(() => validateShaderAuthoringEnvironment(environment)).not.toThrow();
    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "invalid-identifier",
      message: 'Resource "" is not a valid shader identifier.',
    });
  });

  it("derives implementation-only bindings and preserves input member names", () => {
    const resource = { name: "iChannel0", kind: "texture-2d" as const };

    expect(deriveSlangChannelGeneratedIdentifiers({ resource, slot: 0 })).toEqual({
      texture: "_ssTexture0", sampler: "_ssSampler0", channelName: "iChannel0",
    });
    expect(deriveSlangChannelGeneratedIdentifiers({ resource, slot: 5 })).toEqual({
      texture: "_ssTexture5", sampler: "_ssSampler5", channelName: "iChannel0",
    });
    expect(deriveSlangChannelGeneratedIdentifiers({
      resource: { name: "volume", kind: "texture-3d" },
      slot: 0,
    }).channelName).toBe("volume");
  });

  it.each(["", "3d", "not valid", "sky-dome"])(
    "keeps generated Slang APIs total and omits the malformed resource name %j",
    (name) => {
      const resource = { name, kind: "texture-2d" as const };
      const environment = {
        ...baseEnvironment("slang"),
        resources: [resource],
      };

      expect(() => deriveSlangChannelGeneratedIdentifiers({ resource, slot: 0 })).not.toThrow();
      expect(() => buildSlangAuthoringModule(environment)).not.toThrow();
      expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
        code: "invalid-identifier",
        message: `Resource "${name}" is not a valid shader identifier.`,
      });

      const generated = buildSlangAuthoringModule(environment).text;
      expect(generated).not.toContain(`Texture2D<float4> ${name};`);
      expect(generated).not.toContain(`SamplerState ${name}Sampler;`);
    },
  );

  it("reports invalid and duplicate identifiers across uniforms and resources without throwing", () => {
    const environment = {
      ...baseEnvironment("glsl"),
      customUniforms: [
        { name: "not valid", type: "float" },
        { name: "repeat", type: "float" },
        { name: "iTime", type: "float" },
      ],
      resources: [
        { name: "repeat", kind: "texture-2d" },
        { name: "3d", kind: "texture-3d" },
      ],
    };

    expect(() => validateShaderAuthoringEnvironment(environment)).not.toThrow();
    expect(validateShaderAuthoringEnvironment(environment)).toEqual([
      { code: "invalid-identifier", message: 'Custom uniform "not valid" is not a valid shader identifier.' },
      { code: "reserved-identifier", message: 'Custom uniform "iTime" conflicts with a Shader Studio built-in.' },
      { code: "duplicate-identifier", message: 'Resource "repeat" duplicates a custom uniform.' },
      { code: "invalid-identifier", message: 'Resource "3d" is not a valid shader identifier.' },
    ]);
  });

  it("reserves the Slang runtime uniform-buffer identifier without rejecting adjacent names", () => {
    const collision = {
      ...baseEnvironment("slang"),
      customUniforms: [{ name: "_st", type: "float" as const }],
    };
    const control = {
      ...baseEnvironment("slang"),
      customUniforms: [{ name: "_stValue", type: "float" as const }],
    };

    expect(validateShaderAuthoringEnvironment(collision)).toEqual([
      { code: "reserved-identifier", message: 'Custom uniform "_st" conflicts with a Shader Studio built-in.' },
    ]);
    expect(validateShaderAuthoringEnvironment(control)).toEqual([]);
  });

  it.each([
    ["custom uniform", { customUniforms: [{ name: "_ssTexture0", type: "float" as const }], resources: [] }],
    ["storage resource", { customUniforms: [], resources: [{ name: "_ssSampler0", kind: "storage" as const }] }],
    ["input member", { customUniforms: [], resources: [{ name: "_ssTexture0", kind: "texture-2d" as const }] }],
  ] as const)("reserves the Slang _ss implementation namespace for %s", (_label, overrides) => {
    const environment = { ...baseEnvironment("slang"), ...overrides };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual(expect.objectContaining({
      code: "reserved-identifier",
    }));
  });

  it("reserves the Slang runtime uniform block name for an input member", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "_st", kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual(expect.objectContaining({
      code: "reserved-identifier",
    }));
  });

  it.each([
    ["float", "a GLSL scalar type"],
    ["uint", "a GLSL scalar type"],
    ["uvec2", "a GLSL vector type"],
    ["sampler2DShadow", "a GLSL sampler type"],
    ["isampler2D", "a GLSL integer sampler type"],
    ["samplerCubeShadow", "a GLSL shadow sampler type"],
    ["invariant", "a GLSL qualifier"],
    ["smooth", "a GLSL interpolation qualifier"],
    ["noperspective", "a GLSL interpolation qualifier"],
    ["subroutine", "a GLSL subroutine keyword"],
    ["usampler2D", "a GLSL unsigned integer sampler type"],
    ["usamplerCube", "a GLSL unsigned integer sampler type"],
    ["shared", "a GLSL ES reserved word"],
    ["restrict", "a Slang qualifier"],
    ["patch", "a Slang interpolation qualifier"],
    ["sample", "a Slang interpolation qualifier"],
    ["mediump", "the active GLSL ES 300 default precision qualifier"],
    ["bvec4", "a GLSL ES vector type"],
    ["mat4x3", "a GLSL ES matrix type"],
    ["sampler2DArrayShadow", "a GLSL ES shadow sampler type"],
    ["isamplerCube", "a GLSL ES signed sampler type"],
    ["usampler3D", "a GLSL ES unsigned sampler type"],
    ["dmat2", "a GLSL ES future reserved double matrix type"],
    ["samplerCubeArray", "a GLSL ES future reserved sampler type"],
    ["attribute", "a GLSL ES reserved word"],
    ["this", "a GLSL ES reserved word"],
    ["true", "a GLSL ES boolean literal"],
    ["false", "a GLSL ES boolean literal"],
    ["gl_FragCoord", "a reserved GLSL implementation symbol"],
    ["iChannel0", "a renderer channel symbol"],
    ["iCh3", "a renderer channel metadata symbol"],
    ["iWorldPosition", "a renderer mesh context symbol"],
  ])("rejects %s because it is %s", (name) => {
    const environment = {
      ...baseEnvironment("glsl"),
      customUniforms: [{ name, type: "float" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([
      { code: "reserved-identifier", message: `Custom uniform "${name}" conflicts with a Shader Studio built-in.` },
    ]);
  });

  it.each([
    "import",
    "export",
    "groupshared",
    "private",
    "protected",
    "internal",
    "extension",
    "defer",
    "mutating",
  ])("allows the Slang-only contextual identifier %s in GLSL", (name) => {
    const environment = {
      ...baseEnvironment("glsl"),
      customUniforms: [{ name, type: "float" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each([
    "image1DArrayShadow",
    "image1DShadow",
    "image2DArrayShadow",
    "image2DShadow",
    "image2DMS",
    "image2DMSArray",
    "imageCubeArray",
    "iimage2DMS",
    "iimage2DMSArray",
    "iimageCubeArray",
    "operator",
    "precise",
    "uimage2DMS",
    "uimage2DMSArray",
    "uimageCubeArray",
  ])("allows the compiler-usable GLSL ES 300 identifier %s", (name) => {
    const environment = {
      ...baseEnvironment("glsl"),
      customUniforms: [{ name, type: "float" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each([
    ["glsl", "iChannelLoaded"],
    ["glsl", "iChannelN"],
    ["slang", "fragColor"],
    ["slang", "HW_PERFORMANCE"],
    ["slang", "iChannelN"],
  ] as const)("allows %s identifier %s when that language does not own a concrete symbol", (languageId, name) => {
    const environment = {
      ...baseEnvironment(languageId),
      customUniforms: [{ name, type: "float" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each([
    ["glsl", "fragColor"],
    ["glsl", "HW_PERFORMANCE"],
    ["glsl", "iTime"],
    ["glsl", "iChannel0"],
    ["glsl", "iCh0"],
    ["slang", "iTime"],
    ["slang", "iWorldPosition"],
    ["slang", "inputs"],
  ] as const)("rejects %s concrete renderer-owned identifier %s", (languageId, name) => {
    const environment = {
      ...baseEnvironment(languageId),
      customUniforms: [{ name, type: "float" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: `Custom uniform "${name}" conflicts with a Shader Studio built-in.`,
    });
  });

  it.each([
    "protected",
    "internal",
    "extension",
    "this",
    "TextureCubeArray",
    "RWByteAddressBuffer",
    "half3",
    "uint64_t",
    "float16_t4",
    "int64_t2",
    "uint8_t3",
    "gl_FragCoord",
  ])("allows the compiler-usable Slang identifier %s", (name) => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name, kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each(["new", "operator"])("rejects the truly reserved Slang identifier %s", (name) => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name, kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([
      { code: "reserved-identifier", message: `Resource "${name}" conflicts with a Shader Studio built-in.` },
    ]);
  });

  it.each([
    "float",
    "int",
    "float2",
    "float3",
    "float4",
    "Texture2D",
    "SamplerState",
  ])("allows a Slang input member named after a generated type dependency: %s", (name) => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name, kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each(["Texture2D", "SamplerState"])(
    "allows the contextual Slang uniform identifier %s when no generated declaration depends on it",
    (name) => {
      const environment = {
        ...baseEnvironment("slang"),
        customUniforms: [{ name, type: "float" as const }],
      };

      expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    },
  );

  it("allows input member names that would have collided through helper capitalization", () => {
    const mixedShape = {
      ...baseEnvironment("slang"),
      resources: [
        { name: "sky", kind: "texture-2d" as const },
        { name: "Sky", kind: "texture-cube" as const },
      ],
    };
    const identicalShape = {
      ...baseEnvironment("slang"),
      resources: [
        { name: "sky", kind: "texture-2d" as const },
        { name: "Sky", kind: "texture-2d" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(mixedShape)).toEqual([]);
    expect(validateShaderAuthoringEnvironment(identicalShape)).toEqual([]);
  });

  it("reports invalid storage element types without interpolating multiline source", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "particles", kind: "storage" as const, elementType: "Particle\nfloat injected" }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "invalid-element-type",
      message: 'Storage resource "particles" has an invalid element type.',
    });
  });

  it("rejects keyword storage element types", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "particles", kind: "storage" as const, elementType: "uniform" }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "invalid-element-type",
      message: 'Storage resource "particles" has an invalid element type.',
    });
  });

  it("reports physical generated line counts for base, custom, and multiline channel sources", () => {
    const environments = [
      baseEnvironment("glsl"),
      environmentWithCustomUniformAndCubeChannel(),
      { ...baseEnvironment("slang"), resources: [{ name: "sky", kind: "texture-cube" as const }] },
    ];

    for (const environment of environments) {
      const glsl = buildGlslAuthoringPreamble({ ...environment, languageId: "glsl" });
      const slang = buildSlangAuthoringModule({ ...environment, languageId: "slang" });
      expect(glsl.generatedLineCount).toBe(glsl.text.split("\n").length);
      expect(slang.generatedLineCount).toBe(slang.text.split("\n").length);
    }
  });

  it("documents every renderer-visible built-in and channel symbol with a type and runtime meaning", () => {
    const rendererSymbols = [
      "iResolution", "iTime", "iTimeDelta", "iFrameRate", "iMouse", "iFrame", "iDate",
      "iChannelTime", "iChannelResolution", "iSampleRate", "iCameraPos", "iCameraDir",
      "iChannelN", "iChannel0", "iChannel1", "iChannel2", "iChannel3", "iCh0", "iCh1", "iCh2", "iCh3",
      "iWorldPosition", "iNormal", "iCameraPosition",
    ];
    for (const name of rendererSymbols) {
      const documentation = SHADER_STUDIO_SYMBOL_DOCS.find((entry) => entry.name === name);
      expect(documentation).toMatchObject({ name });
      if (documentation?.languages.includes("glsl")) {
        expect(documentation?.glslType).toEqual(expect.any(String));
      }
      expect(documentation?.languages).toContain("glsl");
      expect(documentation?.slangType).toEqual(expect.any(String));
      expect(documentation?.description.length).toBeGreaterThan(0);
    }
  });

  it("does not document obsolete Slang channel globals", () => {
    for (const name of ["iChannelLoaded", "iChannelTime", "iChannelResolution", "iCh0"]) {
      const languages = SHADER_STUDIO_SYMBOL_DOCS.find((entry) => entry.name === name)?.languages;
      expect(languages?.includes("slang") ?? false).toBe(false);
    }
  });

  it("deep-freezes the shared symbol catalog and documentation aliases", () => {
    const builtin = SHADER_STUDIO_BUILTIN_UNIFORMS[0]!;
    const documentation = SHADER_STUDIO_SYMBOL_DOCS[0]!;

    expect(Object.isFrozen(SHADER_STUDIO_BUILTIN_UNIFORMS)).toBe(true);
    expect(Object.isFrozen(builtin)).toBe(true);
    expect(Object.isFrozen(builtin.languages)).toBe(true);
    expect(Reflect.set(builtin, "description", "changed")).toBe(false);
    expect(Reflect.set(builtin.languages, 0, "slang")).toBe(false);
    expect(documentation.description).not.toBe("changed");
  });
});
