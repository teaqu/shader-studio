import { describe, it, expect, vi } from "vitest";
import { SlangCompiler } from "../../webgpu/SlangCompiler";
import type {
  SlangModuleApi,
  SlangCompileTarget,
  SlangVectorLike,
} from "../../webgpu/slangTypes";
import { SLANG_ENTRY_VERTEX, SLANG_ENTRY_FRAGMENT } from "../../webgpu/SlangPrelude";
import type { SlangWorkspaceFile } from "@shader-studio/types";

const imageSource = "float4 mainImage(float2 c) { return float4(1); }";

function workspaceFile(path: string, source: string, uri = `file://${path}`): SlangWorkspaceFile {
  return { path, source, uri };
}

function request(source = imageSource, files: SlangWorkspaceFile[] = [workspaceFile("/workspace/image.slang", source, "file:///image.slang")]) {
  return {
    source,
    sourceUri: "file:///image.slang",
    sourcePath: "/workspace/image.slang",
    workspace: { rootUri: "file:///image.slang", files },
    options: { passName: "Image" },
  };
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
  events?: string[];
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
    FS: {
      mkdirTree: (path: string) => opts.events?.push(`mkdir:${path}`),
      writeFile: (path: string, source: string) => opts.events?.push(`write:${path}:${source}`),
      unlink: (path: string) => opts.events?.push(`unlink:${path}`),
      analyzePath: () => ({ exists: false }),
    },
  } as unknown as SlangModuleApi;
}

describe("SlangCompiler", () => {
  it("compiles a workspace request and always returns structured diagnostics", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ wgsl: "FINAL_WGSL" }));
    expect(compiler.compile(request())).toEqual({
      success: true,
      wgsl: "FINAL_WGSL",
      diagnostics: [],
    });
  });

  it("mounts all workspace files before loading the root without rewriting dependencies", () => {
    const events: string[] = [];
    const onLoad = vi.fn(() => events.push("load:/workspace/image.slang"));
    const compiler = new SlangCompiler(makeFakeSlang({ events, onLoad }));
    const dependency = "// exact dependency\nfloat4 color() { return float4(1); }";
    compiler.compile(request(imageSource, [
      workspaceFile("/workspace/image.slang", imageSource, "file:///image.slang"),
      workspaceFile("/workspace/lib/palette.slang", dependency, "file:///palette.slang"),
    ]));
    expect(events.indexOf(`write:/workspace/lib/palette.slang:${dependency}`)).toBeLessThan(events.indexOf("load:/workspace/image.slang"));
  });

  it("keeps version headers first and leaves newline placeholders before the user body", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));
    const source = "\uFEFF#language slang 2026\nmodule image;\nfloat4 mainImage(float2 c) { return float4(1); }";
    compiler.compile(request(source));
    const assembled = onLoad.mock.calls[0][0] as string;
    expect(assembled.startsWith("\uFEFF#language slang 2026\nmodule image;\n")).toBe(true);
    expect(assembled).toContain("#line 1\n\n\nfloat4 mainImage");
  });

  it("maps stable dependency diagnostics to the matching workspace URI", () => {
    const compiler = new SlangCompiler(makeFakeSlang({
      moduleNull: true,
      lastError: "error[E30001]: unknown name\n  --> /workspace/lib/palette.slang:3:7",
    }));
    const result = compiler.compile(request(imageSource, [
      workspaceFile("/workspace/image.slang", imageSource, "file:///image.slang"),
      workspaceFile("/workspace/lib/palette.slang", "bad", "file:///palette.slang"),
    ]));
    expect(result).toMatchObject({ success: false });
    if (!result.success) expect(result.diagnostics?.[0]).toMatchObject({ uri: "file:///palette.slang", code: "E30001", range: { start: { line: 2, character: 6 } } });
  });

  it("keeps the legacy adapter as a single-root workspace request", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));
    compiler.compileImagePass(imageSource, { passName: "Buffer A" });
    expect(onLoad).toHaveBeenLastCalledWith(expect.any(String), "buffer_a", "/workspace/buffer_a.slang");
  });

  it("compiles user source to WGSL", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ wgsl: "FINAL_WGSL" }));
    const result = compiler.compileImagePass("float4 mainImage(float2 c) { return float4(1); }");
    expect(result).toEqual({ success: true, wgsl: "FINAL_WGSL", diagnostics: [] });
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

    expect(onLoad).toHaveBeenCalledWith(expect.any(String), "buffera", "/workspace/buffera.slang");
  });

  it("defaults the module name to image when no pass name is given", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compileImagePass("float4 mainImage(float2 c) { return float4(0); }");

    expect(onLoad).toHaveBeenCalledWith(expect.any(String), "image", "/workspace/image.slang");
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
