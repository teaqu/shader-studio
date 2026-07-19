import { afterEach, describe, expect, it, vi } from "vitest";

describe("SlangModuleLoader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads the runtime without evaluating JavaScript strings", async () => {
    vi.stubGlobal("Function", function blockedFunctionConstructor() {
      throw new EvalError("unsafe-eval is blocked by CSP");
    });

    const { loadSlangModule } = await import("../../webgpu/SlangModuleLoader");
    const script = [
      "data:text/javascript,",
      encodeURIComponent("export default async options => ({ options });"),
    ].join("");

    const module = await loadSlangModule(script, "https://assets.test/slang-wasm.wasm");

    expect(module).toMatchObject({
      options: { locateFile: expect.any(Function) },
    });
    expect((module as unknown as { options: { locateFile: () => string } }).options.locateFile())
      .toBe("https://assets.test/slang-wasm.wasm");
  });
});
