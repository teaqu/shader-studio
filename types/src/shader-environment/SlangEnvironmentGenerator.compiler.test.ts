// @vitest-environment node

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildSlangAuthoringModule,
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "../index";

interface SlangCompileTarget {
  readonly name: string;
  readonly value: number;
}

interface SlangVectorLike<T> {
  size(): number;
  get(index: number): T;
}

interface SlangTestSession {
  loadModuleFromSource(source: string, moduleName: string, path: string): unknown | null;
}

interface SlangTestModule {
  createGlobalSession(): { createSession(target: number): SlangTestSession | null } | null;
  getCompileTargets(): readonly SlangCompileTarget[] | SlangVectorLike<SlangCompileTarget>;
  getLastError(): { readonly message: string };
}

type CreateSlangModule = () => Promise<SlangTestModule>;

const bundledSlangModuleUrl = new URL("../../../ui/src/slang/slang-wasm.js", import.meta.url);
const bundledSlangWasmUrl = new URL("../../../ui/src/slang/slang-wasm.wasm", import.meta.url);
const hasBundledSlangWasm = existsSync(fileURLToPath(bundledSlangWasmUrl));

function baseEnvironment(): ShaderAuthoringEnvironment {
  return {
    documentUri: "file:///shader-studio-authoring.slang",
    languageId: "slang",
    generation: 1,
    passName: "Image",
    stage: "fragment",
    customUniforms: [],
    resources: [],
    virtualFiles: [],
  };
}

function vectorToArray<T>(value: readonly T[] | SlangVectorLike<T>): readonly T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return Array.from({ length: value.size() }, (_, index) => value.get(index));
}

describe.runIf(hasBundledSlangWasm)("Slang authoring modules with bundled slang-wasm", () => {
  let slang: SlangTestModule;
  let compileTarget: number;
  let globalSession: ReturnType<SlangTestModule["createGlobalSession"]>;

  beforeAll(async () => {
    const module = await import(/* @vite-ignore */ bundledSlangModuleUrl.href) as {
      default: CreateSlangModule;
    };
    slang = await module.default();
    const target = vectorToArray(slang.getCompileTargets()).find(({ name }) => /wgsl/i.test(name));
    if (!target) {
      throw new Error("Bundled Slang compiler does not expose a WGSL target.");
    }
    compileTarget = target.value;
    globalSession = slang.createGlobalSession();
    if (!globalSession) {
      throw new Error("Bundled Slang compiler could not create a global session.");
    }
  }, 30_000);

  function compile(
    environment: ShaderAuthoringEnvironment,
    sourceSuffix = "",
  ): { readonly success: boolean; readonly error: string } {
    const session = globalSession?.createSession(compileTarget);
    if (!session) {
      throw new Error("Bundled Slang compiler could not create a compile session.");
    }
    const moduleName = `authoring_${environment.passName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
    const compiled = session.loadModuleFromSource(
      `${buildSlangAuthoringModule(environment).text}\n${sourceSuffix}`,
      moduleName,
      `/${moduleName}.slang`,
    );
    return {
      success: compiled !== null,
      error: compiled === null ? slang.getLastError().message : "",
    };
  }

  it("compiles base and representative generated authoring modules", () => {
    const representative = {
      ...baseEnvironment(),
      passName: "Representative",
      customUniforms: [{ name: "tint", type: "vec3" as const }],
      resources: [
        { name: "sky", kind: "texture-cube" as const },
        { name: "noise", kind: "texture-2d" as const },
        { name: "volume", kind: "texture-3d" as const },
        { name: "particles", kind: "storage" as const, elementType: "float4" },
      ],
    };

    for (const environment of [baseEnvironment(), representative]) {
      const result = compile(environment);
      expect(result.success, result.error).toBe(true);
    }
  });

  it("compiles every renderer fragment-context symbol from the authoring module", () => {
    const result = compile(
      baseEnvironment(),
      "float4 useFragmentContext() { return float4(iWorldPosition + iNormal + iCameraPosition, 1.0); }",
    );

    expect(result.success, result.error).toBe(true);
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
  ])("compiles a generated resource named with compiler-usable identifier %s", (name) => {
    const environment = {
      ...baseEnvironment(),
      passName: name,
      resources: [{ name, kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    const result = compile(environment);
    expect(result.success, result.error).toBe(true);
  });

  it("compiles mixed-shape helper overloads", () => {
    const environment = {
      ...baseEnvironment(),
      passName: "MixedShapeOverloads",
      resources: [
        { name: "sky", kind: "texture-2d" as const },
        { name: "Sky", kind: "texture-cube" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    const result = compile(environment);
    expect(result.success, result.error).toBe(true);
  });

  it.each(["new", "operator"])("rejects the truly reserved Slang identifier %s", (name) => {
    const environment = {
      ...baseEnvironment(),
      passName: `Reserved_${name}`,
      resources: [{ name, kind: "texture-2d" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: `Resource "${name}" conflicts with a Shader Studio built-in.`,
    });
    const result = compile(environment);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/syntax error|invalid operator/);
  });

  it.each([
    "float",
    "int",
    "float2",
    "float3",
    "float4",
    "Texture2D",
    "SamplerState",
  ])("rejects a resource that shadows generated-module type dependency %s", (name) => {
    const environment = {
      ...baseEnvironment(),
      passName: `GeneratedDependency_${name}`,
      resources: [{ name, kind: "texture-2d" as const }],
    };

    const result = compile(environment);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expected a type|expected a generic/);
    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: `Resource "${name}" conflicts with a Shader Studio built-in.`,
    });
  });

  it.each(["Texture2D", "SamplerState"])(
    "allows a custom uniform named %s when the generated module does not depend on that type",
    (name) => {
      const environment = {
        ...baseEnvironment(),
        passName: `Contextual_${name}`,
        customUniforms: [{ name, type: "float" as const }],
      };

      const result = compile(environment);
      expect(result.success, result.error).toBe(true);
      expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    },
  );

  it.each(["fragColor", "HW_PERFORMANCE", "iChannelN"])(
    "allows the non-Slang fixed/documentation identifier %s",
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

  it.each(["iChannelLoaded", "iTime", "iChannelResolution"])(
    "rejects the concrete Slang built-in identifier %s",
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

  it("rejects a custom uniform that takes a concrete Slang channel binding name", () => {
    const environment = {
      ...baseEnvironment(),
      passName: "Concrete_iChannel0",
      customUniforms: [{ name: "iChannel0", type: "float" as const }],
      resources: [{ name: "iChannel0", kind: "texture-2d" as const }],
    };

    const result = compile(environment);
    expect(result.success).toBe(false);
    expect(result.error).not.toBe("");
    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: 'Custom uniform "iChannel0" conflicts with a Shader Studio built-in.',
    });
  });

  it.each([
    ["bool uniform", {
      stage: "fragment" as const,
      customUniforms: [{ name: "bool", type: "bool" as const }],
      resources: [],
    }],
    ["slot-four Texture2D resource", {
      stage: "fragment" as const,
      customUniforms: [],
      resources: [{ name: "Texture2D", kind: "texture-2d" as const, slot: 4 }],
    }],
    ["slot-four TextureCube resource", {
      stage: "fragment" as const,
      customUniforms: [],
      resources: [{ name: "TextureCube", kind: "texture-cube" as const, slot: 4 }],
    }],
    ["Texture3D resource", {
      stage: "fragment" as const,
      customUniforms: [],
      resources: [{ name: "Texture3D", kind: "texture-3d" as const }],
    }],
    ["StructuredBuffer resource", {
      stage: "fragment" as const,
      customUniforms: [],
      resources: [{ name: "StructuredBuffer", kind: "storage" as const, elementType: "float4" }],
    }],
    ["RWStructuredBuffer resource", {
      stage: "compute" as const,
      customUniforms: [],
      resources: [{ name: "RWStructuredBuffer", kind: "storage" as const, elementType: "float4" }],
    }],
    ["uint storage resource", {
      stage: "fragment" as const,
      customUniforms: [],
      resources: [{ name: "uint", kind: "storage" as const, elementType: "uint" }],
    }],
  ])("allows a type-name self-declaration in its compiler-usable %s context", (label, overrides) => {
    const environment = {
      ...baseEnvironment(),
      ...overrides,
      passName: `SelfDeclaration_${label}`,
    };

    const result = compile(environment);
    expect(result.success, result.error).toBe(true);
    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each([
    ["Atomic<uint> wrapper", "Atomic", "Atomic<uint>"],
    ["Atomic<int> wrapper", "Atomic", "Atomic<int>"],
    ["Atomic<uint> element", "uint", "Atomic<uint>"],
  ] as const)("allows a compute %s to own its type-name declaration", (label, name, elementType) => {
    const environment = {
      ...baseEnvironment(),
      stage: "compute" as const,
      passName: `ComputeSelf_${label}`,
      resources: [{ name, kind: "storage" as const, elementType }],
    };

    const result = compile(environment);
    expect(result.success, result.error).toBe(true);
    expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
  });

  it.each([
    ["Atomic", "Atomic<uint>"],
    ["uint", "Atomic<uint>"],
    ["Atomic", "Atomic<int>"],
    ["int", "Atomic<int>"],
  ] as const)(
    "rejects compute %s when another declaration needs the %s type tokens",
    (name, elementType) => {
      const environment = {
        ...baseEnvironment(),
        stage: "compute" as const,
        passName: `ComputeCross_${name}_${elementType}`,
        customUniforms: [{ name, type: "float" as const }],
        resources: [{ name: "values", kind: "storage" as const, elementType }],
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

  it.each(["Atomic<uint>", "Atomic<int>"] as const)(
    "allows the name Atomic after render storage normalizes %s",
    (elementType) => {
      const environment = {
        ...baseEnvironment(),
        passName: `RenderNormalization_${elementType}`,
        customUniforms: [{ name: "Atomic", type: "float" as const }],
        resources: [{ name: "values", kind: "storage" as const, elementType }],
      };

      const result = compile(environment);
      expect(result.success, result.error).toBe(true);
      expect(validateShaderAuthoringEnvironment(environment)).toEqual([]);
    },
  );

  it.each([
    ["bool", {
      stage: "fragment" as const,
      customUniforms: [
        { name: "bool", type: "float" as const },
        { name: "flag", type: "bool" as const },
      ],
      resources: [],
      expectedNoun: "Custom uniform",
    }],
    ["Texture3D", {
      stage: "fragment" as const,
      customUniforms: [{ name: "Texture3D", type: "float" as const }],
      resources: [{ name: "volume", kind: "texture-3d" as const }],
      expectedNoun: "Custom uniform",
    }],
    ["StructuredBuffer", {
      stage: "fragment" as const,
      customUniforms: [{ name: "StructuredBuffer", type: "float" as const }],
      resources: [{ name: "values", kind: "storage" as const, elementType: "float4" }],
      expectedNoun: "Custom uniform",
    }],
    ["uint", {
      stage: "fragment" as const,
      customUniforms: [],
      resources: [
        { name: "values", kind: "storage" as const, elementType: "uint" },
        { name: "uint", kind: "texture-2d" as const },
      ],
      expectedNoun: "Resource",
    }],
  ])("rejects %s when a different generated declaration depends on that type", (name, overrides) => {
    const environment = {
      ...baseEnvironment(),
      ...overrides,
      passName: `CrossDeclaration_${name}`,
    };

    const result = compile(environment);
    expect(result.success).toBe(false);
    expect(result.error).not.toBe("");
    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "reserved-identifier",
      message: `${overrides.expectedNoun} "${name}" conflicts with a Shader Studio built-in.`,
    });
  });

  it("rejects same-signature helper duplicates", () => {
    const environment = {
      ...baseEnvironment(),
      passName: "SameSignatureCollision",
      resources: [
        { name: "sky", kind: "texture-2d" as const },
        { name: "Sky", kind: "texture-2d" as const },
      ],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "generated-identifier-collision",
        message: expect.stringContaining('"sampleSky"'),
      }),
      expect.objectContaining({
        code: "generated-identifier-collision",
        message: expect.stringContaining('"sampleSkyVertex"'),
      }),
    ]));
    const result = compile(environment);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/function 'sampleSky(?:Vertex)?' already has a body/);
  });

  it("rejects a direct symbol that conflicts with a generated helper", () => {
    const environment = {
      ...baseEnvironment(),
      passName: "DirectSymbolCollision",
      customUniforms: [{ name: "sampleSky", type: "float" as const }],
      resources: [{ name: "sky", kind: "texture-cube" as const }],
    };

    expect(validateShaderAuthoringEnvironment(environment)).toContainEqual({
      code: "generated-identifier-collision",
      message: 'Generated Slang identifier "sampleSky" collides between custom uniform "sampleSky" and resource "sky".',
    });
    const result = compile(environment);
    expect(result.success).toBe(false);
    expect(result.error).toContain("declaration of 'sampleSky' conflicts with existing declaration");
  });
});
