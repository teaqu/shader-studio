import { describe, it, expect, vi } from "vitest";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type {
  SlangModuleApi,
  SlangCompileTarget,
  SlangVectorLike,
} from "../../webgpu/slangTypes";
import {
  SLANG_ENTRY_VERTEX,
  SLANG_ENTRY_FRAGMENT,
  SLANG_ENTRY_COMPUTE,
} from "../../webgpu/SlangPrelude";

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
} = {}): SlangModuleApi {
  const wgsl = opts.wgsl ?? "// wgsl output";
  const linked = {
    link: () => linked,
    getTargetCode: () => wgsl,
  };
  const composite = {
    link: () => (opts.linkNull ? null : linked),
    getTargetCode: () => wgsl,
  };
  const module = {
    findEntryPointByName: (name: string) => {
      opts.onFindEntryPoint?.(name);
      return opts.missingEntryPoint === name ? null : { name };
    },
    link: () => null,
    getTargetCode: () => "",
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
  };
  const globalSession = {
    createSession: () => (opts.sessionNull ? null : session),
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

  it("wraps compute source and links only the compute entry point", () => {
    const onLoad = vi.fn();
    const onFindEntryPoint = vi.fn();
    const onComposite = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({
      onLoad,
      onFindEntryPoint,
      onComposite,
    }));

    const result = compiler.compileImagePass(
      "void computeMain(uint3 tid) { writeOutput(tid.xy, float4(1)); }",
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
    expect(wrapped).toContain(`[shader("compute")]`);
    expect(wrapped).toContain(`[numthreads(4, 2, 1)]`);
    expect(wrapped).toContain(`void ${SLANG_ENTRY_COMPUTE}`);
    expect(wrapped).toContain("Texture2D<float4> iChannel2;");
    expect(wrapped).toContain("RWStructuredBuffer<Particle> particles;");
    expect(wrapped).toContain("WTexture2DArray<float4> _outTex;");
    expect(wrapped).toContain("#define iDispatch");
    expect(wrapped).not.toContain(SLANG_ENTRY_VERTEX);
    expect(wrapped).not.toContain(SLANG_ENTRY_FRAGMENT);
    expect(onFindEntryPoint).toHaveBeenCalledTimes(1);
    expect(onFindEntryPoint).toHaveBeenCalledWith(SLANG_ENTRY_COMPUTE);
    expect(onComposite.mock.calls[0][0]).toHaveLength(2);
  });

  it("uses compute wrapper defaults and emits no output when hasOutput is false", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("void computeMain(uint3 tid) {}", {
      passKind: "compute",
      hasOutput: false,
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[numthreads(8, 8, 1)]");
    expect(wrapped).not.toContain("_outTex");
  });

  it("reports a compute-specific error when the compute entry point is missing", () => {
    const compiler = new SlangCompiler(
      makeFakeSlang({ missingEntryPoint: SLANG_ENTRY_COMPUTE }),
    );

    const result = compiler.compileImagePass("void computeMain(uint3 tid) {}", {
      passKind: "compute",
    });

    expect(result).toEqual({
      success: false,
      errors: ["Slang: compute entry point not found (is `computeMain` defined?)"],
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

  it("lets a standalone shader sample all four standard channels without slot configuration", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(`
      float4 mainImage(float2 c) {
        return sampleIChannel0(c) + sampleIChannel1(c)
          + sampleIChannel2(c) + sampleIChannel3(c);
      }
    `);

    const wrapped = onLoad.mock.calls[0][0] as string;
    for (let slot = 0; slot < 4; slot++) {
      expect(wrapped).toContain(`float4 sampleIChannel${slot}(float2 uv)`);
    }
    expect(wrapped.match(/return float4\(0\.0, 0\.0, 0\.0, 1\.0\);/g)).toHaveLength(4);
    expect(wrapped).not.toContain("Texture2D<float4> iChannel0;");
    expect(wrapped).not.toContain("sampleIChannel4");
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
    expect(wrapped).toContain("Texture2D<float4> iChannel0;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]");
    expect(wrapped).toContain("SamplerState iChannel0Sampler;");
    expect(wrapped).toContain("float4 sampleIChannel0(float2 uv)");
  });

  it("exposes a custom channel through its Slang name and canonical slot helper", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return sampleAlbedo(c); }", {
      passName: "Image",
      channels: [{ slot: 0, key: "albedo", kind: "texture" }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("Texture2D<float4> albedo;");
    expect(wrapped).toContain("SamplerState albedoSampler;");
    expect(wrapped).toContain("float4 sampleAlbedo(float2 uv)");
    expect(wrapped).toContain("float4 sampleIChannel0(float2 uv)");
  });

  it("exposes configured 2D and cubemap channels through iCh objects", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      `float4 mainImage(float2 c) {
        return iCh0.sampler.Sample(c) + iCh2.sampler.Sample(float3(c, 1));
      }`,
      {
        channels: [
          { slot: 0, key: "iChannel0", kind: "texture" },
          { slot: 2, key: "iChannel2", kind: "cubemap" },
        ],
      },
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("struct ShaderToySampler2D");
    expect(wrapped).toContain("struct ShaderToySamplerCube");
    expect(wrapped).toContain("struct ShaderToyChannel2D");
    expect(wrapped).toContain("struct ShaderToyChannelCube");
    expect(wrapped).toContain("ShaderToyChannel2D _getICh0()");
    expect(wrapped).toContain("channel.sampler.texture = iChannel0;");
    expect(wrapped).toContain("channel.size = _st.channelResolution[0];");
    expect(wrapped).toContain("channel.time = _st.channelTime[0];");
    expect(wrapped).toContain("channel.loaded = _st.channelLoaded[0] != 0.0 ? 1 : 0;");
    expect(wrapped).toContain("#define iCh0 (_getICh0())");
    expect(wrapped).toContain("ShaderToyChannelCube _getICh2()");
    expect(wrapped).toContain("#define iCh2 (_getICh2())");
  });

  it("declares ShaderToy audio timing and loaded uniforms", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(iChannelTime[1]); }");

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("float4 channelTime;");
    expect(wrapped).toContain("float4 channelLoaded;");
    expect(wrapped).toContain("float sampleRate;");
    expect(wrapped).toContain("#define iChannelTime (_st.channelTime)");
    expect(wrapped).toContain("#define iChannelLoaded (_st.channelLoaded)");
    expect(wrapped).toContain("#define iSampleRate (_st.sampleRate)");
    expect(wrapped).not.toContain("_audioPad");
  });

  it("declares the remaining GLSL ShaderToy date and channel-resolution uniforms", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      "float4 mainImage(float2 c) { return iDate + float4(iChannelResolution[2], 0); }",
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("float4 date;");
    expect(wrapped).toContain("float3 channelResolution[4];");
    expect(wrapped).toContain("#define iDate (_st.date)");
    expect(wrapped).toContain("#define iChannelResolution (_st.channelResolution)");
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

    compiler.compileImagePass("float4 mainImage(float2 c) { return sampleIChannel0(float3(1, 0, 0)); }", {
      passName: "Image",
      channels: [{ slot: 0, key: "iChannel0", kind: "cubemap" }],
    });

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(1, 0)]]");
    expect(wrapped).toContain("TextureCube<float4> iChannel0;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]");
    expect(wrapped).toContain("SamplerState iChannel0Sampler;");
    expect(wrapped).toContain("float4 sampleIChannel0(float3 dir)");
    expect(wrapped).toContain("return iChannel0.Sample(iChannel0Sampler, dir);");
  });

  it("wraps a sparse audio channel with a 2D sampling helper", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass(
      "float4 mainImage(float2 c) { return sampleIChannel1(float2(c.x, 0.25)); }",
      { channels: [{ slot: 1, key: "iChannel1", kind: "audio" }] },
    );

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nTexture2D<float4> iChannel1;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]\nSamplerState iChannel1Sampler;");
    expect(wrapped).toContain("float4 sampleIChannel1(float2 uv)");
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
    expect(wrapped).toContain("Texture2D<float4> iChannel0;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]");
    expect(wrapped).toContain("SamplerState iChannel0Sampler;");
    expect(wrapped).toContain("[[vk::binding(3, 0)]]");
    expect(wrapped).toContain("Texture2D<float4> iChannel1;");
    expect(wrapped).toContain("[[vk::binding(4, 0)]]");
    expect(wrapped).toContain("SamplerState iChannel1Sampler;");

    // iChannel0's declaration must precede iChannel1's, confirming sort order.
    expect(wrapped.indexOf("Texture2D<float4> iChannel0;")).toBeLessThan(
      wrapped.indexOf("Texture2D<float4> iChannel1;"),
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

    compiler.compileImagePass("float4 mainImage(float2 c) { return sampleIChannel0(c); }", {
      channels: [{ slot: 0, key: "iChannel0" }],
    });

    // The fragment entry flips fragCoord to a bottom-left origin, so uv
    // computed from it is GL-style (v=0 at the bottom). WebGPU textures put
    // v=0 at the TOP row, so the generated helper must flip v when sampling.
    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toContain("iChannel0.Sample(iChannel0Sampler, float2(uv.x, 1.0 - uv.y))");
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
    expect(wrapped).toContain("[[vk::binding(1, 0)]]\nTexture2D<float4> iChannel2;");
    expect(wrapped).toContain("[[vk::binding(2, 0)]]\nSamplerState iChannel2Sampler;");
    expect(wrapped).not.toContain("vk::binding(5");
    expect(wrapped).not.toContain("vk::binding(6");
    expect(wrapped).toContain("float4 sampleIChannel2(float2 uv)");
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
