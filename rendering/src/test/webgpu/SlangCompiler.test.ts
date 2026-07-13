import { describe, it, expect, vi } from "vitest";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type {
  SlangModuleApi,
  SlangCompileTarget,
  SlangVectorLike,
} from "../../webgpu/slangTypes";
import { SLANG_ENTRY_VERTEX, SLANG_ENTRY_FRAGMENT } from "../../webgpu/SlangPrelude";

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
    findEntryPointByName: (name: string) =>
      opts.missingEntryPoint === name ? null : { name },
    link: () => null,
    getTargetCode: () => "",
  };
  const session = {
    loadModuleFromSource: (source: string, name?: string, path?: string) => {
      opts.onLoad?.(source, name, path);
      return opts.moduleNull ? null : module;
    },
    createCompositeComponentType: () => (opts.compositeNull ? null : composite),
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
