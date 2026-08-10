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
  });

  it("describes custom uniforms and resources in both languages", () => {
    const environment = environmentWithCustomUniformAndCubeChannel();

    expect(buildGlslAuthoringPreamble(environment).text).toContain("uniform vec3 tint;");
    expect(buildGlslAuthoringPreamble(environment).text).toContain("uniform samplerCube sky;");
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain("float3 tint");
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain("TextureCube<float4> sky");
  });

  it("models renderer channel slots, metadata, and sampler types without duplicate declarations", () => {
    const environment = {
      ...baseEnvironment("glsl"),
      resources: [
        { name: "iChannel0", kind: "texture-cube" as const },
        { name: "iChannel5", kind: "texture-3d" as const },
      ],
    };
    const glsl = buildGlslAuthoringPreamble(environment);
    const slang = buildSlangAuthoringModule({ ...environment, languageId: "slang" });

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    expect(glsl.text).toContain("uniform samplerCube iChannel0;");
    expect(glsl.text).not.toContain("uniform sampler2D iChannel0;");
    expect(glsl.text).toContain("uniform sampler2D iChannel4;");
    expect(glsl.text).toContain("uniform sampler3D iChannel5;");
    expect(glsl.text).toContain("uniform vec3 iChannelResolution[6];");
    expect(glsl.text).toContain("} iCh0;");
    expect(glsl.text).toContain("  samplerCube sampler;");
    expect(slang.text).toContain("TextureCube<float4> iChannel0;");
    expect(slang.text).toContain("Texture3D<float4> iChannel5;");
    expect(slang.text).toContain("struct ShaderToySamplerCube");
    expect(slang.text).toContain("ShaderToySamplerCube sampler;");
    expect(slang.text).toContain("float4 Sample(float3 dir)");
    expect(slang.text).toContain("ShaderToyChannelCube _getICh0()");
    expect(slang.text).toContain("channel.sampler.texture = iChannel0;");
    expect(slang.text).toContain("channel.size = iChannelResolution[0];");
    expect(slang.text).toContain("#define iCh0 (_getICh0())");
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

  it("uses explicit-level sampling in compute channel metadata", () => {
    const compute = buildSlangAuthoringModule({
      ...baseEnvironment("slang"),
      stage: "compute",
      resources: [{ name: "iChannel0", kind: "texture-cube" }],
    });

    expect(compute.text).toContain("return texture.SampleLevel(state, dir, 0.0);");
    expect(compute.text).not.toContain("return texture.Sample(state, dir);");
  });

  it("reports invalid and duplicate identifiers across uniforms and resources without throwing", () => {
    const environment = {
      ...baseEnvironment("glsl"),
      customUniforms: [
        { name: "not valid", type: "float" },
        { name: "shared", type: "float" },
        { name: "iTime", type: "float" },
      ],
      resources: [
        { name: "shared", kind: "texture-2d" },
        { name: "3d", kind: "texture-3d" },
      ],
    };

    expect(() => validateShaderAuthoringEnvironment(environment)).not.toThrow();
    expect(validateShaderAuthoringEnvironment(environment)).toEqual([
      { code: "invalid-identifier", message: 'Custom uniform "not valid" is not a valid shader identifier.' },
      { code: "reserved-identifier", message: 'Custom uniform "iTime" conflicts with a Shader Studio built-in.' },
      { code: "duplicate-identifier", message: 'Resource "shared" duplicates a custom uniform.' },
      { code: "invalid-identifier", message: 'Resource "3d" is not a valid shader identifier.' },
    ]);
  });

  it.each([
    ["float", "a GLSL and Slang keyword"],
    ["uint", "a GLSL scalar type"],
    ["uvec2", "a GLSL vector type"],
    ["sampler2DShadow", "a GLSL sampler type"],
    ["import", "a Slang keyword"],
    ["groupshared", "a Slang storage keyword"],
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

  it("reports generated line counts for custom uniforms and resources in both languages", () => {
    const environment = environmentWithCustomUniformAndCubeChannel();
    const glsl = buildGlslAuthoringPreamble(environment);
    const slang = buildSlangAuthoringModule({ ...environment, languageId: "slang" });

    expect(glsl.generatedLineCount).toBe(glsl.text.split("\n").length);
    expect(slang.generatedLineCount).toBe(slang.text.split("\n").length);
  });

  it("documents every renderer-visible built-in and channel symbol with a type and runtime meaning", () => {
    const rendererSymbols = [
      "iResolution", "iTime", "iTimeDelta", "iFrameRate", "iMouse", "iFrame", "iDate",
      "iChannelTime", "iChannelLoaded", "iChannelResolution", "iSampleRate", "iCameraPos", "iCameraDir",
      "iChannel0", "iChannel1", "iChannel2", "iChannel3", "iCh0", "iCh1", "iCh2", "iCh3",
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
