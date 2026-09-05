import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  validateShaderAuthoringEnvironment,
  type ShaderAuthoringEnvironment,
} from "@shader-studio/types";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type {
  SlangModuleApi,
  SlangCompileTarget,
  SlangVectorLike,
} from "../../webgpu/slangTypes";
import {
  SLANG_ENTRY_VERTEX,
  SLANG_ENTRY_FRAGMENT,
} from "../../webgpu/SlangPrelude";

function findRealSlangAssets(): { script: string; wasm: string } | null {
  const assetDirectory = resolve(__dirname, "../../../../ui/src/slang");
  const script = resolve(assetDirectory, "slang-wasm.js");
  const configuredWasm = process.env.SHADER_STUDIO_SLANG_WASM_PATH;
  const wasm = configuredWasm
    ? resolve(configuredWasm)
    : resolve(assetDirectory, "slang-wasm.wasm");
  if (existsSync(script) && existsSync(wasm)) {
    return { script, wasm };
  }
  return null;
}

const realSlangAssets = findRealSlangAssets();

async function loadRealSlang(script: string, wasm: string): Promise<SlangModuleApi> {
  const runtime = await import(/* @vite-ignore */ script) as {
    default: (options: { locateFile: () => string }) => Promise<SlangModuleApi>;
  };
  return runtime.default({ locateFile: () => wasm });
}

/** Build a fake slang module whose pieces can be selectively broken. */
function makeFakeSlang(opts: {
  targets?: SlangVectorLike<SlangCompileTarget>;
  globalSessionNull?: boolean;
  sessionNull?: boolean;
  moduleNull?: boolean;
  missingEntryPoint?: string;
  compositeNull?: boolean;
  linkNull?: boolean;
  wgsl?: string;
  lastError?: string;
  onLoad?: (source: string, name?: string, path?: string) => void;
  onFindEntryPoint?: (name: string) => void;
  onComposite?: (components: unknown[]) => void;
  onDelete?: (handle: string) => void;
} = {}): SlangModuleApi {
  const wgsl = opts.wgsl ?? "// wgsl output";
  const linked = {
    link: () => linked,
    getTargetCode: () => wgsl,
    delete: () => opts.onDelete?.("linked"),
  };
  const composite = {
    link: () => (opts.linkNull ? null : linked),
    getTargetCode: () => wgsl,
    delete: () => opts.onDelete?.("composite"),
  };
  const module = {
    findEntryPointByName: (name: string) => {
      opts.onFindEntryPoint?.(name);
      return opts.missingEntryPoint === name ? null : {
        name,
        delete: () => opts.onDelete?.(`entryPoint:${name}`),
      };
    },
    link: () => null,
    getTargetCode: () => "",
    delete: () => opts.onDelete?.("module"),
  };
  const session = {
    loadModuleFromSource: (source: string, name?: string, path?: string) => {
      opts.onLoad?.(source, name, path);
      return opts.moduleNull ? null : module;
    },
    createCompositeComponentType: (components: unknown[]) => {
      opts.onComposite?.(components);
      return opts.compositeNull ? null : composite;
    },
    delete: () => opts.onDelete?.("session"),
  };
  const globalSession = {
    createSession: () => (opts.sessionNull ? null : session),
    delete: () => opts.onDelete?.("globalSession"),
  };

  return {
    createGlobalSession: () => (opts.globalSessionNull ? null : globalSession),
    getCompileTargets: () =>
      opts.targets ?? [
        { name: "GLSL", value: 1 },
        { name: "WGSL", value: 3 },
      ],
    getLastError: () => ({ type: "error", result: -1, message: opts.lastError ?? "" }),
    getVersionString: () => "test",
  } as unknown as SlangModuleApi;
}

describe("SlangCompiler", () => {
  it("releases every per-compile WASM handle after compiling", () => {
    const onDelete = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onDelete }));

    expect(compiler.compileImagePass("float4 mainImage(float2 c) { return 0; }")).toEqual({
      success: true,
      wgsl: "// wgsl output",
    });

    expect(onDelete.mock.calls.map(([handle]) => handle)).toEqual([
      "linked",
      "composite",
      `entryPoint:${SLANG_ENTRY_VERTEX}`,
      `entryPoint:${SLANG_ENTRY_FRAGMENT}`,
      "module",
      "session",
    ]);
  });

  it("releases the session when loading the root module fails", () => {
    const onDelete = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ moduleNull: true, onDelete }));

    expect(compiler.compileImagePass("float4 mainImage(float2 c) { return 0; }")).toEqual({
      success: false,
      errors: ["Slang: failed to compile module"],
    });

    expect(onDelete).toHaveBeenCalledExactlyOnceWith("session");
  });

  it("releases the cached global WASM session when disposed", () => {
    const onDelete = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onDelete }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return 0; }");
    compiler.dispose();
    compiler.dispose();

    expect(onDelete.mock.calls.filter(([handle]) => handle === "globalSession")).toHaveLength(1);
  });

  it.each(["plane", "cube", "sphere"] as const)(
    "generates a %s mesh entry point with fragment compatibility values",
    (geometry) => {
      const onLoad = vi.fn();
      const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

      compiler.compileImagePass(
        `float4 mainImage(float2 fragCoord) {
          return float4(iWorldPosition + iNormal + iCameraPosition, 1);
        }`,
        { geometry },
      );

      const wrapped = onLoad.mock.calls[0][0] as string;
      expect(wrapped).toContain("static float3 iWorldPosition;");
      expect(wrapped).toContain("static float3 iNormal;");
      expect(wrapped).toContain("static float3 iCameraPosition;");
      expect(wrapped).toContain("float4 position : SV_Position;");
      expect(wrapped).toContain("float2 uv : TEXCOORD0;");
      expect(wrapped).toContain("float3 worldPosition : TEXCOORD1;");
      expect(wrapped).toContain("float3 normal : TEXCOORD2;");
      expect(wrapped).toContain("[[vk::location(0)]] float3 position : POSITION");
      expect(wrapped).toContain("[[vk::location(1)]] float3 normal : NORMAL");
      expect(wrapped).toContain("[[vk::location(2)]] float2 uv : TEXCOORD0");
      expect(wrapped).toContain(`iWorldPosition = input.worldPosition;
    iNormal = input.normal;
    iCameraPosition = _mesh.cameraPosition.xyz;
    float4 color = mainImage(input.uv * _st.resolution.xy);`);
      expect(wrapped).toContain("return color;");
      expect(wrapped).not.toContain("_previewWrap");
      expect(wrapped).not.toContain("mapped * _st.resolution.xy");
    },
  );

  it("keeps the fullscreen entry point and zero-initialized compatibility statics by default", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      "float4 mainImage(float2 c) { return float4(iWorldPosition + iNormal + iCameraPosition, 1); }",
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("static float3 iWorldPosition;");
    expect(wrapped).toContain("static float3 iNormal;");
    expect(wrapped).toContain("static float3 iCameraPosition;");
    expect(wrapped).toContain("float2 coord = float2(fragCoord.x, _st.resolution.y - fragCoord.y);");
    expect(wrapped).toContain("return mainImage(coord);");
    expect(wrapped).not.toContain("struct MeshVertexOut");
  });

  it("places mesh uniforms after existing channel bindings", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return inputs.iChannel0.Sample(c); }", {
      geometry: "cube",
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nTexture2D<float4> _ssTexture0;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]\nSamplerState _ssSampler0;");
    expect(wrapped).toContain("[[vk::binding(3, 0)]]\nConstantBuffer<MeshUniforms> _mesh;");
  });

  it.runIf(realSlangAssets)(
    "compiles the mesh adapter with real Slang (set SHADER_STUDIO_SLANG_WASM_PATH when the ignored asset is absent)",
    async () => {
      const slang = await loadRealSlang(realSlangAssets!.script, realSlangAssets!.wasm);
      const compiler = new SlangCompiler(slang);

      const result = compiler.compileImagePass(
        `float4 mainImage(float2 fragCoord) {
          float3 context = iWorldPosition + normalize(iNormal) + iCameraPosition;
          return float4(context + float3(fragCoord, 0), 1);
        }`,
        { geometry: "sphere" },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.wgsl.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it.runIf(realSlangAssets)(
    "reserves the runtime _st object name while a neighboring custom uniform compiles with real Slang",
    async () => {
      const slang = await loadRealSlang(realSlangAssets!.script, realSlangAssets!.wasm);
      const compiler = new SlangCompiler(slang);
      const environment = (name: string): ShaderAuthoringEnvironment => ({
        documentUri: "file:///shader-studio-runtime.slang",
        languageId: "slang",
        generation: 1,
        passName: "Image",
        stage: "fragment",
        customUniforms: [{ name, type: "float" }],
        resources: [],
        virtualFiles: [],
      });

      const collision = compiler.compileImagePass(
        "float4 mainImage(float2 c) { return float4(_st); }",
        { customUniforms: [{ name: "_st", type: "float" }] },
      );
      expect(collision.success).toBe(false);
      if (!collision.success) {
        expect(collision.errors.join("\n")).toMatch(/_st|resolution|member/i);
      }
      const control = compiler.compileImagePass(
        "float4 mainImage(float2 c) { return float4(_stValue); }",
        { customUniforms: [{ name: "_stValue", type: "float" }] },
      );
      expect(control.success, control.success ? "" : control.errors.join("\n")).toBe(true);
      expect(validateShaderAuthoringEnvironment(environment("_st"))).toEqual([
        { code: "reserved-identifier", message: 'Custom uniform "_st" conflicts with a Shader Studio built-in.' },
      ]);
      expect(validateShaderAuthoringEnvironment(environment("_stValue"))).toEqual([]);
    },
  );

  it.runIf(realSlangAssets)(
    "compiles a vertex hook that explicitly samples configured iChannel3 with real Slang",
    async () => {
      const slang = await loadRealSlang(realSlangAssets!.script, realSlangAssets!.wasm);
      const compiler = new SlangCompiler(slang);

      const result = compiler.compileImagePass(
        "float4 mainImage(float2 fragCoord) { return float4(1); }",
        {
          channels: [{ slot: 3, key: "iChannel3" }],
          vertexCode: "void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.x += inputs.iChannel3.SampleLevel(uv, 0.0).x; }",
        },
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.wgsl.trim().length).toBeGreaterThan(0);
      }
    },
  );

  it("compiles user source to WGSL", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ wgsl: "FINAL_WGSL" }));
    const result = compiler.compileImagePass("float4 mainImage(float2 c) { return float4(1); }");
    expect(result).toEqual({ success: true, wgsl: "FINAL_WGSL" });
  });

  it("wraps user source with the prelude and entry points before compiling", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));
    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }");
    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("#line 1");
    expect(wrapped).toContain(SLANG_ENTRY_VERTEX);
    expect(wrapped).toContain(SLANG_ENTRY_FRAGMENT);
    expect(wrapped).toContain("mainImage");
  });

  it("neutralizes the Shader Studio editor import without changing line numbers", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));
    compiler.compileImagePass([
      "import shader_studio;",
      "import palette;",
      "float4 mainImage(float2 c) { return float4(0); }",
    ].join("\n"));

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).not.toContain("import shader_studio;");
    expect(wrapped).toContain("// Shader Studio editor support import");
    // No dependency was supplied, so palette is stripped rather than asking
    // the filesystem-less WASM runtime to resolve it.
    expect(wrapped).not.toContain("import palette;");
    expect(wrapped).toContain("float4 mainImage");
  });

  it("neutralizes the editor import in common code", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));
    compiler.compileImagePass("float4 mainImage(float2 c) { return helper(); }", {
      commonCode: "import \"shader-studio.slang\";\nfloat4 helper() { return 1; }",
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).not.toContain("import \"shader-studio.slang\";");
    expect(wrapped).toContain("float4 helper() { return 1; }");
  });

  it("wraps native compute source and links only its declared entry point", () => {
    const onLoad = vi.fn();
    const onFindEntryPoint = vi.fn();
    const onComposite = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({
      onLoad,
      onFindEntryPoint,
      onComposite,
    }));

    const result = compiler.compileImagePass(
      `[shader("compute")]
      [numthreads(4, 2, 1)]
      void simulate(uint3 tid : SV_DispatchThreadID) { writeOutput(tid.xy, float4(1)); }`,
      {
        passName: "ComputeSim",
        passKind: "compute",
        commonCode: "struct Particle { float4 position; };",
        channels: [{ slot: 2, key: "iChannel2", kind: "buffer" }],
        storage: [{
          name: "particles",
          binding: 0,
          elementType: "Particle",
          builtin: false,
          count: 32,
          stride: 16,
        }],
        workgroupSize: [4, 2, 1],
        outputLayers: 3,
        hasOutput: true,
      },
    );

    expect(result).toEqual({ success: true, wgsl: "// wgsl output" });
    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain(`void simulate(uint3 tid : SV_DispatchThreadID)`);
    expect(wrapped).toContain("Texture2D<float4> _ssTexture2;");
    expect(wrapped).toContain("RWStructuredBuffer<Particle> particles;");
    expect(wrapped).toContain("WTexture2DArray<float4> _outTex;");
    expect(wrapped).toContain("#define iDispatch");
    expect(wrapped).not.toContain(SLANG_ENTRY_VERTEX);
    expect(wrapped).not.toContain(SLANG_ENTRY_FRAGMENT);
    expect(onFindEntryPoint).toHaveBeenCalledTimes(1);
    expect(onFindEntryPoint).toHaveBeenCalledWith("simulate");
    expect(onComposite.mock.calls[0][0]).toHaveLength(2);
  });

  it("preserves native compute attributes and emits no output when hasOutput is false", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(`[shader("compute")] [numthreads(8, 8, 1)] void clear(uint3 tid : SV_DispatchThreadID) {}`, {
      passKind: "compute",
      hasOutput: false,
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("void clear(uint3 tid : SV_DispatchThreadID)");
    expect(wrapped).not.toContain("_outTex");
  });

  it("rejects legacy compute sources without a native entry point", () => {
    const compiler = new SlangCompiler(
      makeFakeSlang(),
    );

    const result = compiler.compileImagePass("void computeMain(uint3 tid) {}", {
      passKind: "compute",
    });

    expect(result).toEqual({
      success: false,
      errors: ['Slang: compute source must declare a native `[shader("compute")]` entry point'],
    });
  });

  it("passes storage to the render wrapper and retains vertex plus fragment entry points", () => {
    const onLoad = vi.fn();
    const onFindEntryPoint = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad, onFindEntryPoint }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return particles[0]; }", {
      passKind: "render",
      storage: [{
        name: "particles",
        binding: 0,
        elementType: "float4",
        builtin: true,
        count: 1,
        stride: 16,
      }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("StructuredBuffer<float4> particles;");
    expect(wrapped).toContain(SLANG_ENTRY_VERTEX);
    expect(wrapped).toContain(SLANG_ENTRY_FRAGMENT);
    expect(onFindEntryPoint.mock.calls.map(([name]) => name)).toEqual([
      SLANG_ENTRY_VERTEX,
      SLANG_ENTRY_FRAGMENT,
    ]);
  });

  it("compiles capture storage as read-only before the shifted capture uniform", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return positions[0]; }", {
      passKind: "render",
      captureMode: true,
      channels: [{ slot: 0, key: "iChannel0" }],
      storage: [{
        name: "positions",
        binding: 0,
        elementType: "float4",
        builtin: true,
        count: 1,
        stride: 16,
      }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(3, 0)]]\nStructuredBuffer<float4> positions;");
    expect(wrapped).toContain("[[vk::binding(4, 0)]]\nConstantBuffer<DbgCaptureUniforms> _dbgCapU;");
    expect(wrapped).not.toContain("RWStructuredBuffer");
    expect(wrapped.indexOf("StructuredBuffer<float4> positions;")).toBeLessThan(
      wrapped.indexOf("ConstantBuffer<DbgCaptureUniforms> _dbgCapU;"),
    );
  });

  it("preloads imported modules before compiling the root module", () => {
    const loads: Array<{ source: string; name?: string; path?: string }> = [];
    const compiler = new SlangCompiler(makeFakeSlang({
      onLoad: (source, name, path) => loads.push({ source, name, path }),
    }));

    compiler.compileImagePass("import palette;\nfloat4 mainImage(float2 c) { return paletteColor(); }", {
      sourcePath: "/shaders/image.slang",
      modules: [{
        moduleName: "palette",
        path: "/shaders/palette.slang",
        source: "module palette;\npublic float4 paletteColor() { return 1; }",
      }],
    });

    expect(loads).toHaveLength(2);
    expect(loads[0]).toEqual({
      source: "module palette;\npublic float4 paletteColor() { return 1; }",
      name: "palette",
      path: "/shaders/palette.slang",
    });
    expect(loads[1].name).toBe("image");
    expect(loads[1].path).toBe("/shaders/image.slang");
  });

  it("stops before the root compile when an imported module fails", () => {
    let loadCount = 0;
    const compiler = new SlangCompiler(makeFakeSlang({
      moduleNull: true,
      lastError: "/shaders/palette.slang(4): error: broken dependency",
      onLoad: () => {
        loadCount += 1;
      },
    }));

    const result = compiler.compileImagePass("float4 mainImage(float2 c) { return 1; }", {
      modules: [{
        moduleName: "palette",
        path: "/shaders/palette.slang",
        source: "broken",
      }],
    });

    expect(loadCount).toBe(1);
    expect(result).toEqual({
      success: false,
      errors: ["/shaders/palette.slang(4): error: broken dependency"],
    });
  });

  it("reports a clean missing-mainImage diagnostic instead of a generated wrapper error", () => {
    const compiler = new SlangCompiler(makeFakeSlang({
      moduleNull: true,
      lastError: `error[E30015]: undefined identifier
  --> /debugmath.slang:34:12
   |
34 | return mainImage(coord);
   |        ^^^^^^^^^ undefined identifier 'mainImage'.`,
    }));

    const result = compiler.compileImagePass(
      "float debugValue(float2 coord) { return coord.x; }",
      { sourcePath: "/debugmath.slang" },
    );

    expect(result).toEqual({
      success: false,
      errors: ["Missing mainImage function"],
    });
  });

  describe("import stripping", () => {
    const depModule = {
      moduleName: "palette",
      path: "/shaders/lib/palette.slang",
      source: "module palette;\npublic float4 paletteColor() { return 1; }",
    };

    it("retains a quoted path import when its dependency is preloaded", () => {
      const loads: Array<{ source: string }> = [];
      const compiler = new SlangCompiler(makeFakeSlang({
        onLoad: (source) => loads.push({ source }),
      }));

      compiler.compileImagePass(
        'import "../lib/palette.slang";\nfloat4 mainImage(float2 c) { return paletteColor(); }',
        { sourcePath: "/shaders/passes/glow.slang", modules: [depModule] },
      );

      const rootSource = loads[loads.length - 1]!.source;
      expect(rootSource).toContain('import "../lib/palette.slang";');
    });

    it("retains an identifier-path import when its dependency is preloaded", () => {
      const loads: Array<{ source: string }> = [];
      const compiler = new SlangCompiler(makeFakeSlang({
        onLoad: (source) => loads.push({ source }),
      }));

      compiler.compileImagePass(
        "import lib.palette;\nfloat4 mainImage(float2 c) { return paletteColor(); }",
        { sourcePath: "/shaders/image.slang", modules: [depModule] },
      );

      const rootSource = loads[loads.length - 1]!.source;
      expect(rootSource).toContain("import lib.palette;");
    });

    it("preserves source lines after the import", () => {
      const loads: Array<{ source: string }> = [];
      const compiler = new SlangCompiler(makeFakeSlang({
        onLoad: (source) => loads.push({ source }),
      }));

      compiler.compileImagePass(
        "import lib.palette;\nfloat4 mainImage(float2 c) { return paletteColor(); }",
        { sourcePath: "/shaders/image.slang", modules: [depModule] },
      );

      const rootSource = loads[loads.length - 1]!.source;
      expect(rootSource).toContain("float4 mainImage");
    });

    it("leaves source without imports unchanged", () => {
      const loads: Array<{ source: string }> = [];
      const compiler = new SlangCompiler(makeFakeSlang({
        onLoad: (source) => loads.push({ source }),
      }));

      compiler.compileImagePass(
        "float4 mainImage(float2 c) { return 1; }",
        { sourcePath: "/shaders/image.slang" },
      );

      const rootSource = loads[loads.length - 1]!.source;
      expect(rootSource).toContain("float4 mainImage");
    });
  });

  describe("dependency composite", () => {
    it("includes dependency modules in createCompositeComponentType", () => {
      const components: unknown[][] = [];
      const compiler = new SlangCompiler(makeFakeSlang({
        onComposite: (c) => components.push([...c]),
      }));

      compiler.compileImagePass(
        "import palette;\nfloat4 mainImage(float2 c) { return paletteColor(); }",
        {
          sourcePath: "/shaders/image.slang",
          modules: [{
            moduleName: "palette",
            path: "/shaders/palette.slang",
            source: "module palette;\npublic float4 paletteColor() { return 1; }",
          }],
        },
      );

      // The composite should have at least 3 items: dependency, root module, and entry points
      expect(components[0]!.length).toBeGreaterThanOrEqual(3);
      // The first items should be the dependency modules
      expect(components[0]![0]).toBe(components[0]![1]); // both are the same fake module object
    });

    it("composite with no dependencies has only root module and entry points", () => {
      const components: unknown[][] = [];
      const compiler = new SlangCompiler(makeFakeSlang({
        onComposite: (c) => components.push([...c]),
      }));

      compiler.compileImagePass(
        "float4 mainImage(float2 c) { return 1; }",
        { sourcePath: "/shaders/image.slang" },
      );

      // Root module + vertex entry + fragment entry = 3
      expect(components[0]!.length).toBe(3);
    });
  });

  it("does not fabricate standard inputs without slot configuration", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(`
      float4 mainImage(float2 c) {
        return inputs.iChannel0.Sample(c) + inputs.iChannel1.Sample(c)
          + inputs.iChannel2.Sample(c) + inputs.iChannel3.Sample(c);
      }
    `);

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("struct ShaderStudioInputs");
    expect(wrapped).not.toContain("property ShaderStudioChannel2D iChannel0");
    expect(wrapped).not.toContain("sampleIChannel0");
    expect(wrapped).not.toContain("Texture2D<float4> _ssTexture0;");
    expect(wrapped).not.toContain("inputs.iChannel4.Sample");
  });

  it("caches the global session across compiles", () => {
    const slang = makeFakeSlang();
    const spy = vi.spyOn(slang, "createGlobalSession");
    const compiler = new SlangCompiler(slang);
    compiler.compileImagePass("a");
    compiler.compileImagePass("b");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fails when there is no WGSL target", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ targets: [{ name: "GLSL", value: 1 }] }));
    const result = compiler.compileImagePass("x");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toMatch(/no WGSL compile target/i);
    }
  });

  it("reads compile targets from an embind vector-like", () => {
    const vec = {
      _items: [{ name: "WGSL", value: 9 }],
      size() {
        return this._items.length;
      },
      get(i: number) {
        return this._items[i];
      },
    };
    const compiler = new SlangCompiler(makeFakeSlang({ targets: vec }));
    expect(compiler.compileImagePass("x").success).toBe(true);
  });

  it("surfaces the slang diagnostic message on module load failure", () => {
    const compiler = new SlangCompiler(
      makeFakeSlang({ moduleNull: true, lastError: "shader(3): error: undefined identifier" }),
    );
    const result = compiler.compileImagePass("broken");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toContain("undefined identifier");
    }
  });

  it("reports a clear error when mainImage is missing", () => {
    const compiler = new SlangCompiler(
      makeFakeSlang({ missingEntryPoint: SLANG_ENTRY_FRAGMENT }),
    );
    const result = compiler.compileImagePass("no main image here");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toMatch(/mainImage/);
    }
  });

  it("fails on link failure with a fallback message when no diagnostic", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ linkNull: true }));
    const result = compiler.compileImagePass("x");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toMatch(/link/i);
    }
  });

  it("does not throw when the global session cannot be created", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ globalSessionNull: true }));
    const result = compiler.compileImagePass("x");
    expect(result.success).toBe(false);
  });

  it("wraps pass source with channel texture and sampler bindings", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return iChannel0.Sample(iChannel0Sampler, c); }", {
      passName: "Image",
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(1, 0)]]");
    expect(wrapped).toContain("Texture2D<float4> _ssTexture0;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]");
    expect(wrapped).toContain("SamplerState _ssSampler0;");
    expect(wrapped).toContain("float4 Sample(float2 uv)");
  });

  it("exposes a custom input through its configured name", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return inputs.albedo.Sample(c); }", {
      passName: "Image",
      channels: [{ slot: 0, key: "albedo", kind: "texture" }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("Texture2D<float4> _ssTexture0;");
    expect(wrapped).toContain("SamplerState _ssSampler0;");
    expect(wrapped).toContain("property ShaderStudioChannel2D albedo");
    expect(wrapped).toContain("float4 Sample(float2 uv)");
  });

  it("exposes configured 2D and cubemap inputs through typed properties", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      `float4 mainImage(float2 c) {
        return inputs.iChannel0.Sample(c) + inputs.iChannel2.Sample(float3(c, 1));
      }`,
      {
        channels: [
          { slot: 0, key: "iChannel0", kind: "texture" },
          { slot: 2, key: "iChannel2", kind: "cubemap" },
        ],
      },
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("struct ShaderStudioChannel2D");
    expect(wrapped).toContain("struct ShaderStudioChannelCube");
    expect(wrapped).toContain("property ShaderStudioChannel2D iChannel0");
    expect(wrapped).toContain("property ShaderStudioChannelCube iChannel2");
    expect(wrapped).toContain("result.size = uint2(_st.channelResolution[0].xy);");
    expect(wrapped).toContain("result.time = _st.channelTime[0];");
    expect(wrapped).not.toMatch(/\biCh\d/);
  });

  it("keeps input timing and loaded values internal to the input properties", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(iTime); }");

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("float channelTime[4];");
    expect(wrapped).toContain("float channelLoaded[4];");
    expect(wrapped).toContain("float sampleRate;");
    expect(wrapped).not.toMatch(/#define iChannel(?:Time|Loaded)/);
    expect(wrapped).toContain("#define iSampleRate (_st.sampleRate)");
    expect(wrapped).not.toContain("_audioPad");
  });

  it("keeps the date global while channel resolution stays on inputs", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      "float4 mainImage(float2 c) { return iDate; }",
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("float4 date;");
    expect(wrapped).toContain("float3 channelResolution[4];");
    expect(wrapped).toContain("#define iDate (_st.date)");
    expect(wrapped).not.toContain("#define iChannelResolution");
  });

  it("exposes channel metadata beyond the legacy 16-slot boundary", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return inputs.iChannel16.Sample(c); }", {
      channels: [{ slot: 16, key: "iChannel16", kind: "texture" }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("float channelTime[17];");
    expect(wrapped).toContain("float channelLoaded[17];");
    expect(wrapped).toContain("float3 channelResolution[17];");
    expect(wrapped).not.toContain("[1024]");
    expect(wrapped).toContain("property ShaderStudioChannel2D iChannel16");
    expect(wrapped).toContain("result.size = uint2(_st.channelResolution[16].xy);");
    expect(wrapped).toContain("result.time = _st.channelTime[16];");
  });

  it("declares the GLSL camera uniforms", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      "float4 mainImage(float2 c) { return float4(iCameraPos + iCameraDir, 1); }",
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("float4 cameraPos;");
    expect(wrapped).toContain("float4 cameraDir;");
    expect(wrapped).toContain("#define iCameraPos (_st.cameraPos.xyz)");
    expect(wrapped).toContain("#define iCameraDir (_st.cameraDir.xyz)");
  });

  it("declares every supported script uniform type in the shared uniform block", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      "float4 mainImage(float2 c) { return tint * gain + float4(offset, enabled ? 1 : 0); }",
      {
        customUniforms: [
          { name: "gain", type: "float" },
          { name: "offset", type: "vec2" },
          { name: "normal", type: "vec3" },
          { name: "tint", type: "vec4" },
          { name: "enabled", type: "bool" },
        ],
      } as any,
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("float custom_gain;");
    expect(wrapped).toContain("float2 custom_offset;");
    expect(wrapped).toContain("float3 custom_normal;");
    expect(wrapped).toContain("float4 custom_tint;");
    expect(wrapped).toContain("int custom_enabled;");
    expect(wrapped).toContain("#define gain (_st.custom_gain)");
    expect(wrapped).toContain("#define enabled (_st.custom_enabled != 0)");
  });

  it("lets the uniform struct pad naturally to 96 bytes", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(iSampleRate); }");

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).not.toContain("float3 _audioPad");
  });

  it("wraps cubemap channels with cube texture bindings and float3 sampling helpers", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return inputs.iChannel0.Sample(float3(1, 0, 0)); }", {
      passName: "Image",
      channels: [{ slot: 0, key: "iChannel0", kind: "cubemap" }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(1, 0)]]");
    expect(wrapped).toContain("TextureCube<float4> _ssTexture0;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]");
    expect(wrapped).toContain("SamplerState _ssSampler0;");
    expect(wrapped).toContain("float4 Sample(float3 dir)");
    expect(wrapped).toContain("return texture.Sample(sampling, dir);");
  });

  it("wraps a sparse audio channel with a 2D sampling helper", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      "float4 mainImage(float2 c) { return inputs.iChannel1.Sample(float2(c.x, 0.25)); }",
      { channels: [{ slot: 1, key: "iChannel1", kind: "audio" }] },
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nTexture2D<float4> _ssTexture1;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]\nSamplerState _ssSampler1;");
    expect(wrapped).toContain("float4 Sample(float2 uv)");
  });

  it("numbers bindings sequentially for multiple channels, sorted by slot", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    // Channels passed out of slot order; wrapper must sort by slot before
    // assigning sequential binding numbers.
    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }", {
      channels: [
        { slot: 1, key: "iChannel1" },
        { slot: 0, key: "iChannel0" },
      ],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(1, 0)]]");
    expect(wrapped).toContain("Texture2D<float4> _ssTexture0;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]");
    expect(wrapped).toContain("SamplerState _ssSampler0;");
    expect(wrapped).toContain("[[vk::binding(3, 0)]]");
    expect(wrapped).toContain("Texture2D<float4> _ssTexture1;");
    expect(wrapped).toContain("[[vk::binding(4, 0)]]");
    expect(wrapped).toContain("SamplerState _ssSampler1;");

    // iChannel0's declaration must precede iChannel1's, confirming sort order.
    expect(wrapped.indexOf("Texture2D<float4> _ssTexture0;")).toBeLessThan(
      wrapped.indexOf("Texture2D<float4> _ssTexture1;"),
    );
  });

  it("emits no channel bindings when channels is an empty array", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }", {
      channels: [],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).not.toContain("vk::binding(1");
    expect(wrapped).not.toContain("Texture2D");
  });

  it("emits no channel bindings when options are omitted entirely", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }");

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).not.toContain("Texture2D");
    expect(wrapped).not.toContain("SamplerState");
  });

  it("injects commonCode before the user source", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return helper(c); }", {
      commonCode: "float4 helper(float2 c) { return float4(c, 0, 1); }",
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("float4 helper(float2 c) { return float4(c, 0, 1); }");
    expect(wrapped.indexOf("float4 helper")).toBeLessThan(wrapped.indexOf("mainImage(float2 c) { return helper"));
  });

  it("places #line 1 immediately before the user source so commonCode does not shift diagnostics", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    const commonCode =
      "float4 helperA(float2 c) { return float4(c, 0, 1); }\nfloat4 helperB(float2 c) { return helperA(c); }";
    const userSource = "float4 mainImage(float2 c) { return helperB(c); }";
    compiler.compileImagePass(userSource, { commonCode });

    const wrapped = onLoad.mock.calls[0][0] as string;
    // #line 1 renumbers the NEXT line, so it must sit directly above the user
    // source — after commonCode — or every user diagnostic is offset by the
    // commonCode line count.
    expect(wrapped).toContain(`#line 1\n${userSource}`);
    // commonCode must be newline-separated from what follows, not concatenated.
    expect(wrapped.indexOf("helperB(float2 c)")).toBeLessThan(wrapped.indexOf("#line 1"));
  });

  it("samples channel textures with flipped v to match the bottom-left fragCoord origin", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return inputs.iChannel0.Sample(c); }", {
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    // The fragment entry flips fragCoord to a bottom-left origin, so uv
    // computed from it is GL-style (v=0 at the bottom). WebGPU textures put
    // v=0 at the TOP row, so the generated helper must flip v when sampling.
    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("texture.Sample(sampling, float2(uv.x, 1.0 - uv.y))");
  });

  it("assigns position-based bindings for sparse channel slots", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    // A pass using only slot 2 still gets the first binding pair (1/2),
    // not slot-derived numbers (5/6). Task 6 bind groups rely on this.
    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }", {
      channels: [{ slot: 2, key: "iChannel2" }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nTexture2D<float4> _ssTexture2;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]\nSamplerState _ssSampler2;");
    expect(wrapped).not.toContain("vk::binding(5");
    expect(wrapped).not.toContain("vk::binding(6");
    expect(wrapped).toContain("float4 Sample(float2 uv)");
  });

  it("names the compiled module after the pass so diagnostics cite the right file", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }", {
      passName: "BufferA",
    });

    expect(onLoad).toHaveBeenCalledWith(expect.any(String), "buffera", "/buffera.slang");
  });

  it("preserves an explicit module declaration when compiling an imported source as the root", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("#language slang 2026\nmodule palette;\nfloat4 mainImage(float2 c) { return 1; }", {
      passName: "capture",
      sourcePath: "/shaders/palette.slang",
    });

    expect(onLoad).toHaveBeenCalledWith(
      expect.any(String),
      "palette",
      "/shaders/palette.slang",
    );
  });

  it("defaults the module name to image when no pass name is given", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }");

    expect(onLoad).toHaveBeenCalledWith(expect.any(String), "image", "/image.slang");
  });

  it("does not mutate the caller's channels array", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    const channels = [
      { slot: 1, key: "iChannel1" },
      { slot: 0, key: "iChannel0" },
    ];
    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }", { channels });

    expect(channels.map((c) => c.slot)).toEqual([1, 0]);
  });
});
