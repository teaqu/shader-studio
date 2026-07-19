import { describe, it, expect, vi } from "vitest";
import {
  SlangCompiler as WorkspaceSlangCompiler,
  type SlangCompileOptions,
  type SlangCompileResult,
} from "../../webgpu/SlangCompiler";
import type {
  SlangModuleApi,
  SlangCompileTarget,
  SlangVectorLike,
} from "../../webgpu/slangTypes";
import { SLANG_ENTRY_VERTEX, SLANG_ENTRY_FRAGMENT } from "../../webgpu/SlangPrelude";
import type { SlangCompileRequest } from "../../webgpu/SlangCompiler";

function compileRequest(overrides: Partial<SlangCompileRequest> = {}): SlangCompileRequest {
  const source = overrides.source ?? "float4 mainImage(float2 c) { return float4(1); }";
  return {
    source,
    sourceUri: "file:///project/image.slang",
    sourcePath: "/workspace/image.slang",
    workspace: {
      rootUri: "file:///project",
      files: [{
        uri: "file:///project/image.slang",
        path: "/workspace/image.slang",
        source,
      }],
    },
    options: {},
    ...overrides,
  };
}

/** Test-only adapter keeping older single-file cases concise. */
class SlangCompiler extends WorkspaceSlangCompiler {
  compileImagePass(source: string, options: SlangCompileOptions = {}): SlangCompileResult {
    const moduleName = (options.passName ?? "image").toLowerCase();
    const sourcePath = `/workspace/${moduleName}.slang`;
    const sourceUri = `file:///${moduleName}.slang`;
    return this.compile(compileRequest({
      source,
      sourceUri,
      sourcePath,
      workspace: {
        rootUri: "file:///",
        files: [{ uri: sourceUri, path: sourcePath, source }],
      },
      options,
    }));
  }
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
  onWrite?: (path: string, source: string) => void;
  onUnlink?: (path: string) => void;
  onDelete?: (handle: string) => void;
  throwAt?: "load" | "entry" | "composite" | "link" | "code";
  aliasLinkedToComposite?: boolean;
  throwDeleteAt?: string;
} = {}): SlangModuleApi {
  const files = new Set<string>();
  const wgsl = opts.wgsl ?? "// wgsl output";
  let linkedDeleted = false;
  let compositeDeleted = false;
  const linked = {
    delete: () => {
      linkedDeleted = true;
      opts.onDelete?.("linked");
      if (opts.throwDeleteAt === "linked") {
        throw new Error("linked delete threw");
      }
    },
    isAliasOf: (other: unknown) => {
      if (linkedDeleted || compositeDeleted) {
        throw new Error("alias check used deleted handle");
      }
      return opts.aliasLinkedToComposite && other === composite;
    },
    link: () => linked,
    getTargetCode: () => {
      if (opts.throwAt === "code") {
        throw new Error("code threw");
      }
      return wgsl;
    },
  };
  const composite = {
    delete: () => {
      compositeDeleted = true;
      opts.onDelete?.("composite");
      if (opts.throwDeleteAt === "composite") {
        throw new Error("composite delete threw");
      }
    },
    isAliasOf: (other: unknown) => {
      if (linkedDeleted || compositeDeleted) {
        throw new Error("alias check used deleted handle");
      }
      return opts.aliasLinkedToComposite && other === linked;
    },
    link: () => {
      if (opts.throwAt === "link") {
        throw new Error("link threw");
      }
      return opts.linkNull ? null : linked;
    },
    getTargetCode: () => wgsl,
  };
  const module = {
    delete: () => opts.onDelete?.("module"),
    isAliasOf: () => false,
    findEntryPointByName: (name: string) => {
      if (opts.throwAt === "entry") {
        throw new Error("entry threw");
      }
      return opts.missingEntryPoint === name ? null : {
        name,
        delete: () => opts.onDelete?.(name),
        isAliasOf: () => false,
      };
    },
    link: () => null,
    getTargetCode: () => "",
  };
  const session = {
    delete: () => opts.onDelete?.("session"),
    isAliasOf: () => false,
    loadModuleFromSource: (source: string, name?: string, path?: string) => {
      if (opts.throwAt === "load") {
        throw new Error("load threw");
      }
      opts.onLoad?.(source, name, path);
      return opts.moduleNull ? null : module;
    },
    createCompositeComponentType: () => {
      if (opts.throwAt === "composite") {
        throw new Error("composite threw");
      }
      return opts.compositeNull ? null : composite;
    },
  };
  const globalSession = {
    delete: () => opts.onDelete?.("global"),
    isAliasOf: () => false,
    createSession: () => {
      linkedDeleted = false;
      compositeDeleted = false;
      return opts.sessionNull ? null : session;
    },
  };

  return {
    FS: {
      mkdirTree: vi.fn(),
      writeFile: vi.fn((path: string, source: string) => {
        files.add(path);
        opts.onWrite?.(path, source);
      }),
      unlink: vi.fn((path: string) => {
        files.delete(path);
        opts.onUnlink?.(path);
      }),
      analyzePath: vi.fn((path: string) => ({ exists: files.has(path) })),
    },
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
  it("deletes transient Embind handles in reverse ownership order after success", () => {
    const deleted: string[] = [];
    const compiler = new SlangCompiler(makeFakeSlang({ onDelete: (handle) => deleted.push(handle) }));

    expect(compiler.compile(compileRequest()).success).toBe(true);

    expect(deleted).toEqual([
      "linked",
      "composite",
      SLANG_ENTRY_FRAGMENT,
      SLANG_ENTRY_VERTEX,
      "module",
      "session",
    ]);
  });

  it.each([
    ["load", ["session"]],
    ["entry", ["module", "session"]],
    ["composite", [SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX, "module", "session"]],
    ["link", ["composite", SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX, "module", "session"]],
    ["code", ["linked", "composite", SLANG_ENTRY_FRAGMENT, SLANG_ENTRY_VERTEX, "module", "session"]],
  ] as const)("deletes every acquired handle when %s throws", (throwAt, expected) => {
    const deleted: string[] = [];
    const compiler = new SlangCompiler(makeFakeSlang({
      throwAt,
      onDelete: (handle) => deleted.push(handle),
    }));

    expect(() => compiler.compile(compileRequest())).toThrow(`${throwAt} threw`);
    expect(deleted).toEqual(expected);
  });

  it("does not double-delete aliased composite and linked handles", () => {
    const deleted: string[] = [];
    const compiler = new SlangCompiler(makeFakeSlang({
      aliasLinkedToComposite: true,
      onDelete: (handle) => deleted.push(handle),
    }));

    compiler.compile(compileRequest());

    expect(deleted.filter((handle) => handle === "linked" || handle === "composite")).toHaveLength(1);
  });

  it("continues deleting remaining handles if one native deletion throws", () => {
    const deleted: string[] = [];
    const compiler = new SlangCompiler(makeFakeSlang({
      throwDeleteAt: "linked",
      onDelete: (handle) => deleted.push(handle),
    }));

    expect(() => compiler.compile(compileRequest())).toThrow("linked delete threw");
    expect(deleted).toEqual([
      "linked",
      "composite",
      SLANG_ENTRY_FRAGMENT,
      SLANG_ENTRY_VERTEX,
      "module",
      "session",
    ]);
  });

  it("idempotently deletes the cached global session on dispose", () => {
    const deleted: string[] = [];
    const compiler = new SlangCompiler(makeFakeSlang({ onDelete: (handle) => deleted.push(handle) }));
    compiler.compile(compileRequest());

    compiler.dispose();
    compiler.dispose();

    expect(deleted.filter((handle) => handle === "global")).toEqual(["global"]);
  });

  it("deletes an uncacheable global session when WGSL is unavailable", () => {
    const deleted: string[] = [];
    const compiler = new SlangCompiler(makeFakeSlang({
      targets: [{ name: "GLSL", value: 1 }],
      onDelete: (handle) => deleted.push(handle),
    }));

    expect(compiler.compile(compileRequest()).success).toBe(false);

    expect(deleted).toEqual(["global"]);
  });
  it("keeps an explicit language and module header before the generated prelude", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compile(compileRequest({
      source: "\uFEFF#language slang 2026\nmodule image;\nfloat4 mainImage(float2 c) { return 1; }\n",
    }));

    const wrapped = onLoad.mock.calls[0][0] as string;
    expect(wrapped).toMatch(/^\uFEFF#language slang 2026\nmodule image;\n\/\/ ---- shader-studio Slang prelude/);
    expect(wrapped.match(/\uFEFF/g)).toHaveLength(1);
  });

  it("compiles directive-free roots under the explicit legacy policy", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));

    compiler.compile(compileRequest({ source: "float4 mainImage(float2 c) { return 1; }" }));

    expect(onLoad.mock.calls[0][0]).toMatch(/^#language slang legacy\n/);
  });

  it("mounts dependencies before loading the root from its real path", () => {
    const events: string[] = [];
    let loadedSource = "";
    const compiler = new SlangCompiler(makeFakeSlang({
      onWrite: (path) => events.push(`write:${path}`),
      onLoad: (source, _name, path) => {
        loadedSource = source;
        events.push(`load:${path}`);
      },
    }));

    compiler.compile(compileRequest({
      source: "import palette;\nfloat4 mainImage(float2 c) { return paletteColor(); }",
      sourcePath: "/workspace/passes/image.slang",
      sourceUri: "file:///project/passes/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/palette.slang", path: "/workspace/palette.slang", source: "module palette; public float4 paletteColor() { return 1; }" },
          { uri: "file:///project/passes/image.slang", path: "/workspace/passes/image.slang", source: "stale root" },
        ],
      },
    }));

    expect(events).toEqual([
      "write:/workspace/palette.slang",
      "write:/workspace/passes/image.slang",
      "write:/workspace/passes/palette.slang",
      "load:/workspace/passes/image.slang",
    ]);
    expect(loadedSource).toContain("import palette;");
    expect(loadedSource).not.toContain("stale root");
  });

  it("keeps a real local module instead of overwriting it with a root projection", () => {
    const writes: Array<[string, string]> = [];
    const compiler = new SlangCompiler(makeFakeSlang({ onWrite: (path, source) => writes.push([path, source]) }));

    compiler.compile(compileRequest({
      sourcePath: "/workspace/passes/image.slang",
      sourceUri: "file:///project/passes/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/palette.slang", path: "/workspace/palette.slang", source: "root palette" },
          { uri: "file:///project/passes/palette.slang", path: "/workspace/passes/palette.slang", source: "local palette" },
          { uri: "file:///project/passes/image.slang", path: "/workspace/passes/image.slang", source: "root" },
        ],
      },
    }));

    expect(writes.filter(([path]) => path === "/workspace/passes/palette.slang"))
      .toEqual([["/workspace/passes/palette.slang", "local palette"]]);
  });

  it("removes compiler-owned module projections before mounting the next snapshot", () => {
    const unlinks: string[] = [];
    const compiler = new SlangCompiler(makeFakeSlang({ onUnlink: (path) => unlinks.push(path) }));
    compiler.compile(compileRequest({
      sourcePath: "/workspace/passes/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/palette.slang", path: "/workspace/palette.slang", source: "palette" },
          { uri: "file:///project/passes/image.slang", path: "/workspace/passes/image.slang", source: "root" },
        ],
      },
    }));

    compiler.compile(compileRequest({
      sourcePath: "/workspace/passes/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [{ uri: "file:///project/passes/image.slang", path: "/workspace/passes/image.slang", source: "root" }],
      },
    }));

    expect(unlinks).toContain("/workspace/passes/palette.slang");
  });

  it("maps diagnostics from a projected module back to its real workspace URI", () => {
    const compiler = new SlangCompiler(makeFakeSlang({
      moduleNull: true,
      lastError: "error[E30015]: undefined identifier\n  --> /workspace/passes/palette.slang:2:4",
    }));
    const result = compiler.compile(compileRequest({
      sourcePath: "/workspace/passes/image.slang",
      sourceUri: "file:///project/passes/image.slang",
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/palette.slang", path: "/workspace/palette.slang", source: "bad palette" },
          { uri: "file:///project/passes/image.slang", path: "/workspace/passes/image.slang", source: "root" },
        ],
      },
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.diagnostics[0]?.uri).toBe("file:///project/palette.slang");
    }
  });

  it("returns structured diagnostics with the real dependency URI", () => {
    const compiler = new SlangCompiler(makeFakeSlang({
      moduleNull: true,
      lastError: "/workspace/lib/palette.slang(3,7): error 30001: unknown name",
    }));

    const result = compiler.compile(compileRequest({
      workspace: {
        rootUri: "file:///project",
        files: [
          { uri: "file:///project/image.slang", path: "/workspace/image.slang", source: "root" },
          { uri: "file:///project/lib/palette.slang", path: "/workspace/lib/palette.slang", source: "bad" },
        ],
      },
    }));

    expect(result).toEqual({
      success: false,
      errors: ["/workspace/lib/palette.slang(3,7): error 30001: unknown name"],
      diagnostics: [{
        uri: "file:///project/lib/palette.slang",
        range: { start: { line: 2, character: 6 }, end: { line: 2, character: 6 } },
        severity: "error",
        code: "30001",
        message: "unknown name",
        source: "slang-compile",
      }],
    });
  });

  it("preserves an unrecognized diagnostic as a raw root diagnostic", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ moduleNull: true, lastError: "opaque compiler failure" }));
    const result = compiler.compile(compileRequest());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.diagnostics[0]).toMatchObject({
        uri: "file:///project/image.slang",
        message: "opaque compiler failure",
        source: "slang-compile",
      });
    }
  });

  it("parses the modern Slang diagnostic envelope without depending on source excerpts", () => {
    const compiler = new SlangCompiler(makeFakeSlang({
      moduleNull: true,
      lastError: "error[E00001]: cannot open file 'palette.slang'\n  --> /workspace/lib/palette.slang:3:8\n   |\n 3 | import palette;",
    }));
    const result = compiler.compile(compileRequest({
      workspace: {
        rootUri: "file:///project",
        files: [{
          uri: "file:///project/lib/palette.slang",
          path: "/workspace/lib/palette.slang",
          source: "bad",
        }],
      },
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.diagnostics).toEqual([expect.objectContaining({
        uri: "file:///project/lib/palette.slang",
        range: { start: { line: 2, character: 7 }, end: { line: 2, character: 7 } },
        severity: "error",
        code: "E00001",
        message: "cannot open file 'palette.slang'",
      })]);
    }
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
