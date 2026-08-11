// @vitest-environment node

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildGlslAuthoringPreamble,
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "../index";

const hasGlslangValidator = spawnSync("glslangValidator", ["--version"], {
  encoding: "utf8",
}).status === 0;

function baseEnvironment(): ShaderAuthoringEnvironment {
  return {
    documentUri: "file:///shader-studio-authoring.frag",
    languageId: "glsl",
    generation: 1,
    passName: "Image",
    stage: "fragment",
    customUniforms: [],
    resources: [],
    virtualFiles: [],
  };
}

function compile(environment: ShaderAuthoringEnvironment, expression = "vec4(1.0)"): {
  readonly success: boolean;
  readonly error: string;
} {
  const source = `#version 300 es
${buildGlslAuthoringPreamble(environment).text}
void main()
{
    fragColor = ${expression};
}
`;
  const result = spawnSync("glslangValidator", ["--stdin", "-S", "frag"], {
    encoding: "utf8",
    input: source,
  });
  return {
    success: result.status === 0,
    error: `${result.stdout}${result.stderr}`,
  };
}

describe.runIf(hasGlslangValidator)("GLSL authoring preambles with glslangValidator", () => {
  it("compiles every renderer fragment-context symbol from the authoring preamble", () => {
    const result = compile(
      baseEnvironment(),
      "vec4(iWorldPosition + iNormal + iCameraPosition, 1.0)",
    );

    expect(result.success, result.error).toBe(true);
  });

  it.each(["iChannelLoaded", "iChannelN"])(
    "allows the non-GLSL fixed/documentation identifier %s",
    (name) => {
      const environment = {
        ...baseEnvironment(),
        passName: `CrossLanguage_${name}`,
        customUniforms: [{ name, type: "float" as const }],
      };

      const result = compile(environment);
      expect(result.success, result.error).toBe(true);
      expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    },
  );

  it.each(["fragColor", "HW_PERFORMANCE", "iTime", "iChannel0", "iCh0"])(
    "rejects the concrete GLSL renderer-owned identifier %s",
    (name) => {
      const environment = {
        ...baseEnvironment(),
        passName: `Concrete_${name}`,
        customUniforms: [{ name, type: "float" as const }],
      };

      const result = compile(environment);
      expect(result.success).toBe(false);
      expect(result.error).not.toBe("");
      expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
        code: "reserved-identifier",
        message: `Custom uniform "${name}" conflicts with a Shader Studio built-in.`,
      });
    },
  );

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
  ])("allows the compiler-usable GLSL ES 300 declaration identifier %s", (name) => {
    const environment = {
      ...baseEnvironment(),
      passName: `Usable_${name}`,
      customUniforms: [{ name, type: "float" as const }],
    };

    const result = compile(environment);
    expect(result.success, result.error).toBe(true);
    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each(["true", "false", "shared", "dmat2", "samplerCubeArray"])(
    "rejects the compiler-reserved GLSL ES 300 declaration identifier %s",
    (name) => {
      const environment = {
        ...baseEnvironment(),
        passName: `Reserved_${name}`,
        customUniforms: [{ name, type: "float" as const }],
      };

      const result = compile(environment);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/syntax error|Reserved word/);
      expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
        code: "reserved-identifier",
        message: `Custom uniform "${name}" conflicts with a Shader Studio built-in.`,
      });
    },
  );
});
