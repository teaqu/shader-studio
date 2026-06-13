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
  onLoad?: (source: string) => void;
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
    loadModuleFromSource: (source: string) => {
      opts.onLoad?.(source);
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
    if (!result.success) expect(result.errors[0]).toMatch(/no WGSL compile target/i);
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
    if (!result.success) expect(result.errors[0]).toContain("undefined identifier");
  });

  it("reports a clear error when mainImage is missing", () => {
    const compiler = new SlangCompiler(
      makeFakeSlang({ missingEntryPoint: SLANG_ENTRY_FRAGMENT }),
    );
    const result = compiler.compileImagePass("no main image here");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]).toMatch(/mainImage/);
  });

  it("fails on link failure with a fallback message when no diagnostic", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ linkNull: true }));
    const result = compiler.compileImagePass("x");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]).toMatch(/link/i);
  });

  it("does not throw when the global session cannot be created", () => {
    const compiler = new SlangCompiler(makeFakeSlang({ globalSessionNull: true }));
    const result = compiler.compileImagePass("x");
    expect(result.success).toBe(false);
  });
});
