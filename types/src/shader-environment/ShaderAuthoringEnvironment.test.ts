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
    expect(generated.generatedLineCount).toBe(GLSL_STABLE_DECLARATION_LINES.length + 5);
  });

  it("describes custom uniforms and resources in both languages", () => {
    const environment = environmentWithCustomUniformAndCubeChannel();

    expect(buildGlslAuthoringPreamble(environment).text).toContain("uniform vec3 tint;");
    expect(buildGlslAuthoringPreamble(environment).text).toContain("uniform samplerCube sky;");
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain("float3 tint");
    expect(buildSlangAuthoringModule({ ...environment, languageId: "slang" }).text).toContain("TextureCube<float4> sky");
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

  it("documents every stable built-in with a type and runtime meaning", () => {
    for (const builtin of SHADER_STUDIO_BUILTIN_UNIFORMS) {
      const documentation = SHADER_STUDIO_SYMBOL_DOCS.find((entry) => entry.name === builtin.name);
      expect(documentation).toMatchObject({ name: builtin.name });
      if (builtin.glslType) {
        expect(documentation?.glslType).toEqual(expect.any(String));
      } else {
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
});
