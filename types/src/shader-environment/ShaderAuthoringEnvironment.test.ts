import { describe, expect, it } from "vitest";
import {
  buildGlslAuthoringPreamble,
  buildSlangAuthoringModule,
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
    for (const slot of [0, 1, 2, 3]) {
      expect(slang.text).toContain(`float4 sampleIChannel${slot}(float2 uv)`);
    }
  });

  it("describes custom uniforms and resources in both languages", () => {
    const environment = environmentWithCustomUniformAndCubeChannel();

    expect(buildGlslAuthoringPreamble(environment).text).toContain("uniform vec3 tint;");
    expect(buildGlslAuthoringPreamble(environment).text).toContain("uniform samplerCube sky;");
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain("float3 tint");
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain("TextureCube<float4> sky");
  });

  it("models renderer channel slots, aliases, metadata, and sampler types in insertion order", () => {
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
    expect(glsl.text).toContain("  samplerCube sampler;");
    expect(slang.text).toContain("TextureCube<float4> sky;");
    expect(slang.text).toContain("SamplerState skySampler;");
    expect(slang.text).toContain("float4 sampleIChannel0(float3 dir)");
    expect(slang.text).toContain("return sky.Sample(skySampler, dir);");
    expect(slang.text).toContain("float4 sampleIChannel0Vertex(float3 dir)");
    expect(slang.text).toContain("return sky.SampleLevel(skySampler, dir, 0.0);");
    expect(slang.text).toContain("float4 sampleSky(float3 dir)");
    expect(slang.text).toContain("return sampleIChannel0(dir);");
    expect(slang.text).toContain("float4 sampleIChannel1(float2 uv)");
    expect(slang.text).toContain("return noise.Sample(noiseSampler, float2(uv.x, 1.0 - uv.y));");
    expect(slang.text).toContain("float4 sampleNoiseVertex(float2 uv)");
    expect(slang.text).not.toContain("#define iChannel0 sky");
    expect(slang.text).not.toContain("#define iChannel0Sampler skySampler");
    expect(slang.text).toContain("struct ShaderToySamplerCube");
    expect(slang.text).toContain("ShaderToySamplerCube sampler;");
    expect(slang.text).toContain("float4 Sample(float3 dir)");
    expect(slang.text).toContain("ShaderToyChannelCube _getICh0()");
    expect(slang.text).toContain("channel.sampler.texture = sky;");
    expect(slang.text).toContain("channel.size = iChannelResolution[0];");
    expect(slang.text).toContain("#define iCh0 (_getICh0())");
  });

  it("keeps numeric-looking channel aliases distinct from canonical slot names", () => {
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
    ["float", "float", "float"],
    ["vec2", "vec2", "float2"],
    ["vec3", "vec3", "float3"],
    ["vec4", "vec4", "float4"],
    ["bool", "bool", "bool"],
    ["int", "int", "int"],
  ] as const)("generates the %s uniform type in both languages", (type, glslType, slangType) => {
    const environment = {
      ...baseEnvironment("glsl"),
      customUniforms: [{ name: "value", type: type as AuthoringValueType }],
    };

    expect(buildGlslAuthoringPreamble(environment).text).toContain(`uniform ${glslType} value;`);
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain(`${slangType} value;`);
  });

  it.each([
    ["texture-2d", "uniform sampler2D resource;", "Texture2D<float4> resource;"],
    ["texture-cube", "uniform samplerCube resource;", "TextureCube<float4> resource;"],
    ["texture-3d", "uniform sampler3D resource;", "Texture3D<float4> resource;"],
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

  it("rejects storage resources that collide with renderer channel symbols without emitting duplicate declarations", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "iChannel0", kind: "storage" as const, elementType: "float4" }],
    };
    const glsl = buildGlslAuthoringPreamble({ ...environment, languageId: "glsl" });
    const slang = buildSlangAuthoringModule(environment);

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: 'Resource "iChannel0" conflicts with a Shader Studio built-in.',
    });
    expect(glsl.text.match(/uniform sampler2D iChannel0;/g)).toHaveLength(1);
    expect(slang.text).not.toContain("StructuredBuffer<float4> iChannel0;");
  });

  it("uses explicit-level sampling in compute channel metadata", () => {
    const compute = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      stage: "compute",
      resources: [{ name: "iChannel0", kind: "texture-cube" }],
    });

    expect(compute.text).toContain("return texture.SampleLevel(state, dir, 0.0);");
    expect(compute.text).not.toContain("return texture.Sample(state, dir);");
    expect(compute.text).toContain("float4 sampleIChannel0(float3 dir)");
    expect(compute.text).toContain("return iChannel0.SampleLevel(iChannel0Sampler, dir, 0.0);");
  });

  it.each([
    "sampleIChannel0",
    "sampleIChannel0Vertex",
    "sampleSky",
    "sampleSkyVertex",
  ])("rejects a custom uniform that collides with generated Slang helper %s", (name) => {
    const environment = {
      ...baseEnvironment("slang"),
      customUniforms: [{ name, type: "float" as const }],
      resources: [{ name: "sky", kind: "texture-cube" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "generated-identifier-collision",
      message: `Generated Slang identifier "${name}" collides between custom uniform "${name}" and resource "sky".`,
    });
  });

  it("rejects a resource name that collides with its generated canonical helper", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [{ name: "sampleIChannel0", kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "generated-identifier-collision",
      message: "Generated Slang identifier \"sampleIChannel0\" collides between resource \"sampleIChannel0\" and resource \"sampleIChannel0\".",
    });
  });

  it("rejects case-derived helper collisions between resources", () => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [
        { name: "sky", kind: "texture-cube" as const },
        { name: "Sky", kind: "texture-cube" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual(expect.arrayContaining([
      {
        code: "generated-identifier-collision",
        message: "Generated Slang identifier \"sampleSky\" collides between resource \"sky\" and resource \"Sky\".",
      },
      {
        code: "generated-identifier-collision",
        message: "Generated Slang identifier \"sampleSkyVertex\" collides between resource \"sky\" and resource \"Sky\".",
      },
    ]));
  });

  it.each([
    ["skySampler", "skySampler"],
    ["_getICh0", "_getICh0"],
    ["ShaderToySampler2D", "ShaderToySampler2D"],
  ])("rejects %s when it collides with generated identifier %s", (name, generatedName) => {
    const environment = {
      ...baseEnvironment("slang"),
      resources: [
        { name: "sky", kind: "texture-2d" as const },
        { name, kind: "texture-2d" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "generated-identifier-collision",
      message: expect.stringContaining(`Generated Slang identifier "${generatedName}" collides`),
    });
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

  it.each([
    ["float", "a GLSL and Slang keyword"],
    ["uint", "a GLSL scalar type"],
    ["uvec2", "a GLSL vector type"],
    ["sampler2DShadow", "a GLSL sampler type"],
    ["isampler2D", "a GLSL integer sampler type"],
    ["samplerCubeShadow", "a GLSL shadow sampler type"],
    ["invariant", "a GLSL qualifier"],
    ["smooth", "a GLSL interpolation qualifier"],
    ["noperspective", "a GLSL interpolation qualifier"],
    ["precise", "a GLSL precision qualifier"],
    ["subroutine", "a GLSL subroutine keyword"],
    ["usampler2D", "a GLSL unsigned integer sampler type"],
    ["usamplerCube", "a GLSL unsigned integer sampler type"],
    ["import", "a Slang keyword"],
    ["export", "a Slang keyword"],
    ["groupshared", "a Slang storage keyword"],
    ["shared", "a Slang storage keyword"],
    ["restrict", "a Slang qualifier"],
    ["patch", "a Slang interpolation qualifier"],
    ["sample", "a Slang interpolation qualifier"],
    ["private", "a Slang access keyword"],
    ["mediump", "the active GLSL ES 300 default precision qualifier"],
    ["bvec4", "a GLSL ES vector type"],
    ["mat4x3", "a GLSL ES matrix type"],
    ["sampler2DArrayShadow", "a GLSL ES shadow sampler type"],
    ["isamplerCube", "a GLSL ES signed sampler type"],
    ["usampler3D", "a GLSL ES unsigned sampler type"],
    ["attribute", "a GLSL ES reserved word"],
    ["protected", "a Slang access keyword"],
    ["internal", "a Slang access keyword"],
    ["extension", "a Slang declaration keyword"],
    ["this", "a Slang expression keyword"],
    ["operator", "a Slang declaration keyword"],
    ["defer", "a Slang statement keyword"],
    ["mutating", "a Slang modifier"],
    ["half3", "a Slang vector type"],
    ["uint64_t", "a Slang scalar type"],
    ["float16_t4", "an extended Slang floating-point vector type"],
    ["int64_t2", "an extended Slang signed vector type"],
    ["uint8_t3", "an extended Slang unsigned vector type"],
    ["TextureCubeArray", "a Slang texture type"],
    ["RWByteAddressBuffer", "a Slang buffer type"],
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
      "iChannelTime", "iChannelLoaded", "iChannelResolution", "iSampleRate", "iCameraPos", "iCameraDir",
      "iChannelN", "iChannel0", "iChannel1", "iChannel2", "iChannel3", "iCh0", "iCh1", "iCh2", "iCh3",
    ];
    for (const name of rendererSymbols) {
      const documentation = SHADER_STUDIO_SYMBOL_DOCS.find((entry) => entry.name === name);
      expect(documentation).toMatchObject({ name });
      if (documentation?.languages.includes("glsl")) {
        expect(documentation?.glslType).toEqual(expect.any(String));
      }
      if (documentation?.languages?.length === 1) {
        expect(documentation?.languages).toEqual(["slang"]);
      }
      expect(documentation?.slangType).toEqual(expect.any(String));
      expect(documentation?.description.length).toBeGreaterThan(0);
    }
  });

  it("marks the Slang-only channel loaded state as unavailable in GLSL", () => {
    expect(SHADER_STUDIO_SYMBOL_DOCS.find((entry) => entry.name === "iChannelLoaded")).toMatchObject({
      name: "iChannelLoaded",
      slangType: "float4",
      languages: ["slang"],
    });
    expect(SHADER_STUDIO_SYMBOL_DOCS.find((entry) => entry.name === "iChannelLoaded")?.glslType).toBeUndefined();
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
