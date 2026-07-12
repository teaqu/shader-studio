import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebGPURenderingEngine } from "../../webgpu/WebGPURenderingEngine";

// createCompiler()'s worker-first/fallback wiring is exercised here without a
// real Worker or slang-wasm: the collaborators it calls out to are mocked so
// each branch (worker used / worker rejected -> fallback / no workerUrl / no
// Worker global) can be driven directly.
vi.mock("../../webgpu/AsyncSlangCompiler", () => ({
  WorkerSlangCompiler: { create: vi.fn() },
  MainThreadSlangCompiler: vi.fn().mockImplementation(function (this: unknown, inner: unknown) {
    return { kind: "main-thread", inner };
  }),
}));
vi.mock("../../webgpu/SlangModuleLoader", () => ({
  loadSlangModule: vi.fn(async () => ({ slangModule: true })),
}));
vi.mock("../../webgpu/SlangCompiler", () => ({
  SlangCompiler: vi.fn().mockImplementation(function (this: unknown, slang: unknown) {
    return { kind: "slang-compiler", slang };
  }),
}));

import { WorkerSlangCompiler, MainThreadSlangCompiler } from "../../webgpu/AsyncSlangCompiler";
import { loadSlangModule } from "../../webgpu/SlangModuleLoader";
import { SlangCompiler } from "../../webgpu/SlangCompiler";

const workerCreate = WorkerSlangCompiler.create as unknown as ReturnType<typeof vi.fn>;
const mainThreadCtor = MainThreadSlangCompiler as unknown as ReturnType<typeof vi.fn>;
const loadSlangModuleMock = loadSlangModule as unknown as ReturnType<typeof vi.fn>;
const slangCompilerCtor = SlangCompiler as unknown as ReturnType<typeof vi.fn>;

/** Stand-in Worker constructor so `typeof Worker !== "undefined"` can be toggled per test. */
class FakeWorker {
  constructor(public url: string | URL, public options: unknown) {}
}

describe("WebGPURenderingEngine.createCompiler", () => {
  beforeEach(() => {
    workerCreate.mockReset();
    mainThreadCtor.mockClear();
    loadSlangModuleMock.mockClear();
    slangCompilerCtor.mockClear();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => `source:${url}`,
      arrayBuffer: async () => new ArrayBuffer(8),
    })));
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:slang-worker")
      .mockReturnValueOnce("blob:slang-js")
      .mockReturnValueOnce("blob:slang-wasm");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("(a) loads the worker and Slang assets into blob URLs when a workerUrl is configured", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const fakeCompiler = { compile: vi.fn(async () => ({ success: true })), dispose: vi.fn() };
    workerCreate.mockResolvedValue(fakeCompiler);

    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
    const compiler = await (engine as unknown as { createCompiler(): Promise<{
      compile(source: string, options: unknown): Promise<unknown>;
      dispose(): void;
    }> }).createCompiler();

    expect(workerCreate).toHaveBeenCalledTimes(1);
    const [factory, scriptUrl, wasmUrl, initTimeoutMs, onStatus] = workerCreate.mock.calls[0];
    expect(scriptUrl).toBe("blob:slang-js");
    expect(wasmUrl).toBe("blob:slang-wasm");
    expect(initTimeoutMs).toBe(1500);
    expect(onStatus).toEqual(expect.any(Function));
    expect(fetch).toHaveBeenCalledWith("worker.js");
    expect(fetch).toHaveBeenCalledWith("s.js");
    expect(fetch).toHaveBeenCalledWith("s.wasm");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
    // VS Code webviews reject Worker(vscode-resource-url), so the factory
    // must construct from a same-origin blob URL instead.
    const worker = factory();
    expect(worker).toBeInstanceOf(FakeWorker);
    expect(worker.url).toBe("blob:slang-worker");
    expect(worker.options).toEqual({ type: "module" });
    await compiler.compile("source", {});
    expect(fakeCompiler.compile).toHaveBeenCalledWith("source", {});
    compiler.dispose();
    expect(fakeCompiler.dispose).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:slang-worker");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:slang-js");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:slang-wasm");
    expect(loadSlangModuleMock).not.toHaveBeenCalled();
    expect(mainThreadCtor).not.toHaveBeenCalled();
  });

  it("logs worker setup timings when Slang timing debug is enabled", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const fakeCompiler = { compile: vi.fn(), dispose: vi.fn() };
    workerCreate.mockImplementation(async (_factory, _scriptUrl, _wasmUrl, _timeoutMs, onStatus) => {
      onStatus?.({ type: "status", label: "boot" });
      return fakeCompiler;
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const engine = new WebGPURenderingEngine({
        scriptUrl: "s.js",
        wasmUrl: "s.wasm",
        workerUrl: "worker.js",
        debugTimings: true,
      });
      await (engine as unknown as { createCompiler(): Promise<unknown> }).createCompiler();

      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] worker fetch start", { workerUrl: "worker.js" });
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] worker init start", { workerUrl: "worker.js" });
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] worker status", {
        workerUrl: "worker.js",
        type: "status",
        label: "boot",
      });
      expect(logSpy).toHaveBeenCalledWith("[SlangPerf] worker setup", expect.objectContaining({
        mode: "worker",
        workerUrl: "worker.js",
        fetchMs: expect.any(Number),
        blobMs: expect.any(Number),
        initMs: expect.any(Number),
        totalMs: expect.any(Number),
      }));
    } finally {
      logSpy.mockRestore();
    }
  });

  it("(b) falls back to the main-thread compiler and warns when WorkerSlangCompiler.create() rejects", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const initError = new Error("worker init failed");
    workerCreate.mockRejectedValue(initError);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
      const compiler = await (engine as unknown as { createCompiler(): Promise<unknown> }).createCompiler();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/worker compiler unavailable/i);
      expect(warnSpy.mock.calls[0][1]).toBe(initError);
      expect(loadSlangModuleMock).toHaveBeenCalledWith("s.js", "s.wasm");
      expect(slangCompilerCtor).toHaveBeenCalledWith({ slangModule: true });
      expect(mainThreadCtor).toHaveBeenCalledTimes(1);
      expect(compiler).toEqual({ kind: "main-thread", inner: { kind: "slang-compiler", slang: { slangModule: true } } });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("still attempts the worker for VS Code webview resource URLs", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const fakeCompiler = { compile: vi.fn(), dispose: vi.fn() };
    workerCreate.mockResolvedValue(fakeCompiler);

    const engine = new WebGPURenderingEngine({
      scriptUrl: "s.js",
      wasmUrl: "s.wasm",
      workerUrl: "https://file+.vscode-resource.vscode-cdn.net/Users/test/extension/ui-dist/assets/slangCompileWorker.js",
    });
    await (engine as unknown as { createCompiler(): Promise<unknown> }).createCompiler();

    expect(workerCreate).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://file+.vscode-resource.vscode-cdn.net/Users/test/extension/ui-dist/assets/slangCompileWorker.js");
    expect(fetch).toHaveBeenCalledWith("s.js");
    expect(fetch).toHaveBeenCalledWith("s.wasm");
    expect(loadSlangModuleMock).not.toHaveBeenCalled();
  });

  it("falls back to the main-thread compiler when the emitted worker chunk cannot be fetched", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "",
    } as Response);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "missing-worker.js" });
      const compiler = await (engine as unknown as { createCompiler(): Promise<unknown> }).createCompiler();

      expect(fetch).toHaveBeenCalledWith("missing-worker.js");
      expect(workerCreate).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][1]).toEqual(new Error("Failed to load Slang worker asset (404)"));
      expect(loadSlangModuleMock).toHaveBeenCalledWith("s.js", "s.wasm");
      expect(compiler).toEqual({ kind: "main-thread", inner: { kind: "slang-compiler", slang: { slangModule: true } } });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("(c) uses the main-thread compiler directly, without constructing a Worker, when no workerUrl is configured", async () => {
    vi.stubGlobal("Worker", FakeWorker);

    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    await (engine as unknown as { createCompiler(): Promise<unknown> }).createCompiler();

    expect(workerCreate).not.toHaveBeenCalled();
    expect(loadSlangModuleMock).toHaveBeenCalledWith("s.js", "s.wasm");
    expect(mainThreadCtor).toHaveBeenCalledTimes(1);
  });

  it("(d) uses the main-thread compiler when Worker is undefined even though a workerUrl is configured", async () => {
    expect(typeof Worker).toBe("undefined");

    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
    await (engine as unknown as { createCompiler(): Promise<unknown> }).createCompiler();

    expect(workerCreate).not.toHaveBeenCalled();
    expect(loadSlangModuleMock).toHaveBeenCalledWith("s.js", "s.wasm");
    expect(mainThreadCtor).toHaveBeenCalledTimes(1);
  });
});
