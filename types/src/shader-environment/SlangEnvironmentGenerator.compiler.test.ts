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

  function compile(environment: ShaderAuthoringEnvironment): { readonly success: boolean; readonly error: string } {
    const session = globalSession?.createSession(compileTarget);
    if (!session) {
      throw new Error("Bundled Slang compiler could not create a compile session.");
    }
    const moduleName = `authoring_${environment.passName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
    const compiled = session.loadModuleFromSource(
      buildSlangAuthoringModule(environment).text,
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
