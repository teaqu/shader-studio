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
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "self.onmessage = () => {}",
    })));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:slang-worker");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("(a) loads the emitted worker chunk into a blob worker when a workerUrl is configured", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const fakeCompiler = { compile: vi.fn(), dispose: vi.fn() };
    workerCreate.mockResolvedValue(fakeCompiler);

    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
    const compiler = await (engine as unknown as { createCompiler(): Promise<unknown> }).createCompiler();

    expect(compiler).toBe(fakeCompiler);
    expect(workerCreate).toHaveBeenCalledTimes(1);
    const [factory, scriptUrl, wasmUrl] = workerCreate.mock.calls[0];
    expect(scriptUrl).toBe("s.js");
    expect(wasmUrl).toBe("s.wasm");
    expect(fetch).toHaveBeenCalledWith("worker.js");
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    // VS Code webviews reject Worker(vscode-resource-url), so the factory
    // must construct from a same-origin blob URL instead.
    const worker = factory();
    expect(worker).toBeInstanceOf(FakeWorker);
    expect(worker.url).toBe("blob:slang-worker");
    expect(worker.options).toEqual({ type: "module" });
    expect(loadSlangModuleMock).not.toHaveBeenCalled();
    expect(mainThreadCtor).not.toHaveBeenCalled();
  });

  it("logs worker setup timings when Slang timing debug is enabled", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const fakeCompiler = { compile: vi.fn(), dispose: vi.fn() };
    workerCreate.mockResolvedValue(fakeCompiler);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const engine = new WebGPURenderingEngine({
        scriptUrl: "s.js",
        wasmUrl: "s.wasm",
        workerUrl: "worker.js",
        debugTimings: true,
      });
      await (engine as unknown as { createCompiler(): Promise<unknown> }).createCompiler();

      expect(infoSpy).toHaveBeenCalledWith("[SlangPerf] worker setup", expect.objectContaining({
        mode: "worker",
        workerUrl: "worker.js",
        fetchMs: expect.any(Number),
        blobMs: expect.any(Number),
        initMs: expect.any(Number),
        totalMs: expect.any(Number),
      }));
    } finally {
      infoSpy.mockRestore();
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
      expect(warnSpy.mock.calls[0][1]).toEqual(new Error("Failed to load Slang worker (404)"));
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
