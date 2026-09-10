import { describe, expect, it } from "vitest";
import {
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "../index";

function baseWgslEnvironment(): ShaderAuthoringEnvironment {
  return {
    documentUri: "file:///shaders/image.wgsl",
    languageId: "wgsl",
    generation: 7,
    passName: "Image",
    stage: "fragment",
    customUniforms: [],
    resources: [],
    virtualFiles: [],
  };
}

describe("ShaderAuthoringEnvironment WGSL reserved identifiers", () => {
  it.each([
    ["fn", "a WGSL keyword"],
    ["enable", "a WGSL directive keyword"],
    ["f32", "a WGSL predeclared type"],
    ["vec4f", "a WGSL predeclared alias"],
    ["writeOutput", "the WGSL compute output helper"],
    ["mainImage", "the WGSL fragment hook"],
    ["mainVertex", "the WGSL vertex hook"],
    ["vertexMain", "the WGSL vertex entry point"],
    ["fragmentMain", "the WGSL fragment entry point"],
  ])("rejects %s (%s) as a custom uniform name", (name) => {
    const environment: ShaderAuthoringEnvironment = {
      ...baseWgslEnvironment(),
      customUniforms: [{ name, type: "float" }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: `Custom uniform "${name}" conflicts with a Shader Studio built-in.`,
    });
  });

  it.each([
    ["fn", "a WGSL keyword"],
    ["writeOutput", "the WGSL compute output helper"],
    ["mainImage", "the WGSL fragment hook"],
  ])("rejects %s (%s) as a storage buffer name", (name) => {
    const environment: ShaderAuthoringEnvironment = {
      ...baseWgslEnvironment(),
      resources: [{ name, kind: "storage", elementType: "float4" }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: `Resource "${name}" conflicts with a Shader Studio built-in.`,
    });
  });

  it.each([
    ["fn", "a WGSL keyword"],
    ["f32", "a WGSL predeclared type"],
    ["writeOutput", "the WGSL compute output helper"],
  ])("rejects %s (%s) as a channel name", (name) => {
    const environment: ShaderAuthoringEnvironment = {
      ...baseWgslEnvironment(),
      resources: [{ name, kind: "texture-2d" }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: `Resource "${name}" conflicts with a Shader Studio built-in.`,
    });
  });

  it.each([
    "iChannel0Sample",
    "iChannel0SampleLevel",
    "iChannel0SampleGrad",
    "iChannel0Size",
    "iChannel0Time",
    "iChannel0Loaded",
    "iChannel3Sample",
  ])("rejects a name colliding with a generated accessor (%s)", (name) => {
    const environment: ShaderAuthoringEnvironment = {
      ...baseWgslEnvironment(),
      customUniforms: [{ name, type: "float" }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: `Custom uniform "${name}" conflicts with a Shader Studio built-in.`,
    });
  });

  it("reserves the WGSL _ss implementation namespace", () => {
    const environment: ShaderAuthoringEnvironment = {
      ...baseWgslEnvironment(),
      customUniforms: [{ name: "_ss_u", type: "float" }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual(
      expect.objectContaining({ code: "reserved-identifier" }),
    );
  });

  it("accepts a legal custom uniform, storage buffer, and channel name", () => {
    const environment: ShaderAuthoringEnvironment = {
      ...baseWgslEnvironment(),
      customUniforms: [{ name: "tint", type: "vec3" }],
      resources: [
        { name: "particles", kind: "storage", elementType: "float4" },
        { name: "sky", kind: "texture-cube" },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });
});
