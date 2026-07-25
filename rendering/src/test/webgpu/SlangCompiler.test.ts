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
  onGlobalDelete?: () => void;
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
    delete: () => opts.onGlobalDelete?.(),
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

type FailureStage = "session" | "load" | "vertex" | "fragment" | "composite" | "link" | "code";

function makeInstrumentedSlang(stage?: FailureStage | `${FailureStage}-null`, events: string[] = [], aliases = false, deleteThrows?: string, aliasThrows = false): SlangModuleApi {
  const handle = (name: string) => ({
    delete() { events.push(`delete:${name}`); if (deleteThrows === name) throw new Error(`delete ${name}`); },
    isAliasOf(other: { name?: string }) { if (aliasThrows) throw new Error("alias"); return aliases && name === "linked" && other.name === "composite"; },
    name,
  });
  const linked = { ...handle("linked"), getTargetCode() { if (stage === "code") throw new Error("code"); return stage === "code-null" ? "" : "WGSL"; }, link() { return linked; } };
  const composite = { ...handle("composite"), link() { if (stage === "link") throw new Error("link"); return stage === "link-null" ? null : linked; }, getTargetCode: () => "" };
  const vertex = handle("vertex");
  const fragment = handle("fragment");
  const module = {
    ...handle("module"),
    findEntryPointByName(name: string) {
      const failure = name === SLANG_ENTRY_VERTEX ? "vertex" : "fragment";
      if (stage === failure) throw new Error(failure);
      if (stage === `${failure}-null`) return null;
      return name === SLANG_ENTRY_VERTEX ? vertex : fragment;
    },
    link: () => null, getTargetCode: () => "",
  };
  const session = {
    ...handle("session"),
    loadModuleFromSource() { if (stage === "load") throw new Error("load"); return stage === "load-null" ? null : module; },
    createCompositeComponentType() { if (stage === "composite") throw new Error("composite"); return stage === "composite-null" ? null : composite; },
  };
  const global = { ...handle("global"), createSession() { if (stage === "session") throw new Error("session"); return stage === "session-null" ? null : session; } };
  return {
    createGlobalSession: () => global,
    getCompileTargets: () => [{ name: "WGSL", value: 3 }],
    getLastError: () => ({ type: "error", result: -1, message: `raw ${stage ?? ""}` }),
    FS: { mkdirTree() {}, writeFile() {}, unlink() {}, analyzePath: () => ({ exists: false }) },
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
    const loadIndex = events.indexOf("load:/workspace/image.slang");
    expect(loadIndex).toBeGreaterThanOrEqual(0);
    for (const write of [
      `write:/workspace/image.slang:${imageSource}`,
      `write:/workspace/lib/palette.slang:${dependency}`,
    ]) {
      expect(events.indexOf(write)).toBeGreaterThanOrEqual(0);
      expect(events.indexOf(write)).toBeLessThan(loadIndex);
    }
  });

  it("loads the request source at the exact nested source path without changing mounted snapshot files", () => {
    const events: string[] = [];
    const onLoad = vi.fn((_source: string, _name: string, path: string) => events.push(`load:${path}`));
    const compiler = new SlangCompiler(makeFakeSlang({ events, onLoad }));
    const result = compiler.compile({
      ...request("float4 mainImage(float2 c) { return float4(9); }", [
        workspaceFile("/workspace/passes/image.slang", "SNAPSHOT_ROOT", "file:///image.slang"),
        workspaceFile("/workspace/lib/one.slang", "#language slang 2026\nmodule one;", "file:///one.slang"),
        workspaceFile("/workspace/lib/two.slang", "line1\nline2", "file:///two.slang"),
      ]),
      sourcePath: "/workspace/passes/image.slang",
    });
    expect(result.success).toBe(true);
    expect(events).toContain("write:/workspace/passes/image.slang:SNAPSHOT_ROOT");
    expect(events).toContain("write:/workspace/lib/one.slang:#language slang 2026\nmodule one;");
    expect(events).toContain("write:/workspace/lib/two.slang:line1\nline2");
    expect(events.find((event) => event.startsWith("load:"))).toBe("load:/workspace/passes/image.slang");
    expect(onLoad.mock.calls[0][0]).toContain("return float4(9)");
    expect(onLoad.mock.calls[0][0]).not.toContain("SNAPSHOT_ROOT");
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

  it.each([
    ["directive-free legacy LF", "\uFEFF// leading\nfloat4 mainImage(float2 c) { return float4(1); }", "\uFEFF#language slang legacy\n", "\n"],
    ["explicit legacy CR", "\uFEFF#language slang legacy\r// trivia\rfloat4 mainImage(float2 c) { return float4(1); }", "\uFEFF#language slang legacy\r", "\r"],
    ["2025 CRLF", "#language slang 2025\r\nmodule image;\r\nfloat4 mainImage(float2 c) { return float4(1); }", "#language slang 2025\r\nmodule image;\r\n", "\r\n"],
    ["2026 LF", "#language slang 2026\nmodule image;\nfloat4 mainImage(float2 c) { return float4(1); }", "#language slang 2026\nmodule image;\n", "\n"],
    ["latest LF", "#language slang latest\nmodule image;\nfloat4 mainImage(float2 c) { return float4(1); }", "#language slang latest\nmodule image;\n", "\n"],
  ])("assembles %s roots with stable declaration and body ordering", (_label, source, expectedHeader, newline) => {
    const onLoad = vi.fn();
    new SlangCompiler(makeFakeSlang({ onLoad })).compile(request(source));
    const assembled = onLoad.mock.calls[0][0] as string;
    expect(assembled.startsWith(expectedHeader)).toBe(true);
    expect(assembled.indexOf("struct ShaderToyUniforms")).toBeGreaterThanOrEqual(expectedHeader.length);
    expect(assembled).toContain(`#line 1${newline}`);
    expect(assembled.indexOf("mainImage(float2 c)")).toBeLessThan(assembled.indexOf(SLANG_ENTRY_VERTEX));
    expect(assembled.lastIndexOf(SLANG_ENTRY_FRAGMENT)).toBeGreaterThan(assembled.indexOf("mainImage(float2 c)"));
    expect(assembled.match(/\uFEFF/g)?.length ?? 0).toBe(source.startsWith("\uFEFF") ? 1 : 0);
  });

  it("rejects unsupported root language unchanged before module loading", () => {
    const onLoad = vi.fn();
    const source = "#language slang 2030\nfloat4 mainImage(float2 c) { return float4(1); }";
    const result = new SlangCompiler(makeFakeSlang({ onLoad })).compile(request(source));
    expect(result).toMatchObject({ success: false, diagnostics: [expect.objectContaining({ uri: "file:///image.slang" })] });
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("assembles capture-mode roots after version declarations and before capture entries", () => {
    const onLoad = vi.fn();
    const source = "#language slang 2026\nmodule image;\nfloat4 mainImage(float2 c) { return float4(c, 0, 1); }";
    new SlangCompiler(makeFakeSlang({ onLoad })).compile({ ...request(source), options: { captureMode: true } });
    const assembled = onLoad.mock.calls[0][0] as string;
    expect(assembled.startsWith("#language slang 2026\nmodule image;\n")).toBe(true);
    expect(assembled.indexOf("struct DbgCaptureUniforms")).toBeGreaterThan(assembled.indexOf("module image;"));
    expect(assembled).toContain("#line 1\n\n\nfloat4 mainImage");
    expect(assembled.indexOf("float4 mainImage")).toBeLessThan(assembled.lastIndexOf("_dbgCapU.isPixelMode"));
    expect(assembled).toContain("_dbgCapU.coordGrid.xy");
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

  it("parses ordered stable diagnostic envelopes with exact paths, severities, codes, and zero-based ranges", () => {
    const raw = [
      "error[E1]: first", " --> /workspace/lib/a.slang:3:7",
      "warning[W2]: second", " --> /workspace/lib/a.slang.more:4:8",
      "note[N3]: third", " --> /workspace/lib/a.slang:5:9",
      "info[I4]: fourth", " --> /workspace/lib/a.slang.more:6:10",
    ].join("\r\n");
    const result = new SlangCompiler(makeFakeSlang({ moduleNull: true, lastError: raw })).compile(request(imageSource, [
      workspaceFile("/workspace/image.slang", imageSource, "file:///image.slang"),
      workspaceFile("/workspace/lib/a.slang", "a", "file:///a.slang"),
      workspaceFile("/workspace/lib/a.slang.more", "b", "file:///more.slang"),
    ]));
    expect(result).toMatchObject({ success: false, errors: [raw] });
    if (!result.success) expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code: "E1", uri: "file:///a.slang", range: { start: { line: 2, character: 6 }, end: { line: 2, character: 6 } } }),
      expect.objectContaining({ severity: "warning", code: "W2", uri: "file:///more.slang", range: { start: { line: 3, character: 7 }, end: { line: 3, character: 7 } } }),
      expect.objectContaining({ severity: "information", code: "N3", uri: "file:///a.slang" }),
      expect.objectContaining({ severity: "information", code: "I4", uri: "file:///more.slang" }),
    ]);
  });

  it.each([
    ["error[E9]: unknown\r  --> /workspace/nope.slang:1:1", "unknown stable"],
    ["totally raw compiler failure", "unparseable"],
  ])("keeps %s diagnostics as one full root raw message", (raw) => {
    const result = new SlangCompiler(makeFakeSlang({ moduleNull: true, lastError: raw })).compile(request());
    if (!result.success) {
      expect(result.errors).toEqual([raw]);
      expect(result.diagnostics).toEqual([expect.objectContaining({ uri: "file:///image.slang", message: raw, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } })]);
    }
  });

  it("keeps the legacy adapter as a single-root workspace request", () => {
    const onLoad = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onLoad }));
    compiler.compileImagePass(imageSource, { passName: "Buffer A" });
    expect(onLoad).toHaveBeenLastCalledWith(expect.any(String), "buffer_a", "/workspace/buffer_a.slang");
  });

  it("deletes acquired per-compile handles in reverse acquisition order", () => {
    const events: string[] = [];
    expect(new SlangCompiler(makeInstrumentedSlang(undefined, events)).compile(request()).success).toBe(true);
    expect(events).toEqual(["delete:linked", "delete:composite", "delete:fragment", "delete:vertex", "delete:module", "delete:session"]);
  });

  it.each([
    ["session-null", []], ["session", []], ["load-null", ["delete:session"]], ["load", ["delete:session"]],
    ["vertex-null", ["delete:module", "delete:session"]], ["vertex", ["delete:module", "delete:session"]],
    ["fragment-null", ["delete:vertex", "delete:module", "delete:session"]], ["fragment", ["delete:vertex", "delete:module", "delete:session"]],
    ["composite-null", ["delete:fragment", "delete:vertex", "delete:module", "delete:session"]], ["composite", ["delete:fragment", "delete:vertex", "delete:module", "delete:session"]],
    ["link-null", ["delete:composite", "delete:fragment", "delete:vertex", "delete:module", "delete:session"]], ["link", ["delete:composite", "delete:fragment", "delete:vertex", "delete:module", "delete:session"]],
    ["code-null", ["delete:linked", "delete:composite", "delete:fragment", "delete:vertex", "delete:module", "delete:session"]], ["code", ["delete:linked", "delete:composite", "delete:fragment", "delete:vertex", "delete:module", "delete:session"]],
  ] as const)("cleans every acquired handle when %s fails", (stage, expected) => {
    const events: string[] = [];
    const result = new SlangCompiler(makeInstrumentedSlang(stage, events)).compile(request());
    expect(result.success).toBe(false);
    expect(events).toEqual(expected);
  });

  it("deduplicates aliases and continues cleanup after delete or alias checks throw", () => {
    const aliased: string[] = [];
    new SlangCompiler(makeInstrumentedSlang(undefined, aliased, true, "fragment")).compile(request());
    expect(aliased.filter((event) => event === "delete:composite").length + aliased.filter((event) => event === "delete:linked").length).toBe(1);
    expect(aliased).toContain("delete:module");
  });

  it("continues reverse cleanup when both alias comparisons throw", () => {
    const events: string[] = [];
    const result = new SlangCompiler(makeInstrumentedSlang(undefined, events, false, undefined, true)).compile(request());
    expect(result).toMatchObject({ success: true, wgsl: "WGSL" });
    expect(events).toEqual(["delete:linked", "delete:composite", "delete:fragment", "delete:vertex", "delete:module", "delete:session"]);
  });

  it("disposes mounted paths and its cached global once, then rejects later compiles", () => {
    const events: string[] = [];
    const slang = makeInstrumentedSlang(undefined, events);
    const files = new Set<string>();
    slang.FS = {
      mkdirTree() {}, writeFile(path) { files.add(path); },
      unlink(path) { events.push(`unlink:${path}`); files.delete(path); },
      analyzePath(path) { return { exists: files.has(path) }; },
    };
    const compiler = new SlangCompiler(slang);
    compiler.compile(request());
    compiler.dispose(); compiler.dispose();
    expect(events.filter((event) => event === "delete:global")).toHaveLength(1);
    expect(events).toContain("unlink:/workspace/image.slang");
    expect(compiler.compile(request())).toMatchObject({ success: false, diagnostics: expect.any(Array) });
  });

  it("retries failed workspace unlink cleanup without deleting the global twice", () => {
    const events: string[] = [];
    const slang = makeInstrumentedSlang(undefined, events);
    const files = new Set<string>();
    let fail = true;
    slang.FS = {
      mkdirTree() {}, writeFile(path) { files.add(path); },
      unlink(path) { events.push(`unlink:${path}`); if (fail) throw new Error("unlink"); files.delete(path); },
      analyzePath(path) { return { exists: files.has(path) }; },
    };
    const compiler = new SlangCompiler(slang);
    compiler.compile(request());
    compiler.dispose();
    expect(files.has("/workspace/image.slang")).toBe(true);
    expect(events.filter((event) => event === "delete:global")).toHaveLength(1);
    fail = false;
    compiler.dispose(); compiler.dispose();
    expect(files.size).toBe(0);
    expect(events.filter((event) => event === "delete:global")).toHaveLength(1);
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

  it("releases a newly-created global session when target lookup throws", () => {
    const onGlobalDelete = vi.fn();
    const compiler = new SlangCompiler(makeFakeSlang({ onGlobalDelete, targets: {
      size: () => { throw new Error("target vector failed"); },
      get: () => ({ name: "WGSL", value: 3 }),
    } }));
    const result = compiler.compile(request());
    expect(result).toMatchObject({ success: false });
    expect(onGlobalDelete).toHaveBeenCalledTimes(1);
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
