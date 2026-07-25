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

interface TestCompiler {
  compile(source: string, options: unknown): Promise<unknown>;
  dispose(): void;
}

function createCompiler(engine: WebGPURenderingEngine): Promise<TestCompiler> {
  return (engine as unknown as { createCompiler(): Promise<TestCompiler> }).createCompiler();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function assetResponse(url: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => `source:${url}`,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as Response;
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
      compile(request: unknown): Promise<unknown>;
      dispose(): void;
    }> }).createCompiler();

    expect(workerCreate).toHaveBeenCalledTimes(1);
    const [factory, scriptUrl, wasmUrl, initTimeoutMs, onStatus] = workerCreate.mock.calls[0];
    expect(scriptUrl).toBe("blob:slang-js");
    expect(wasmUrl).toBe("blob:slang-wasm");
    expect(initTimeoutMs).toBe(1500);
    expect(onStatus).toEqual(expect.any(Function));
    expect(fetch).toHaveBeenCalledWith("worker.js", { signal: expect.anything() });
    expect(fetch).toHaveBeenCalledWith("s.js", { signal: expect.anything() });
    expect(fetch).toHaveBeenCalledWith("s.wasm", { signal: expect.anything() });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
    // VS Code webviews reject Worker(vscode-resource-url), so the factory
    // must construct from a same-origin blob URL instead.
    const worker = factory();
    expect(worker).toBeInstanceOf(FakeWorker);
    expect(worker.url).toBe("blob:slang-worker");
    expect(worker.options).toEqual({ type: "module" });
    const request = { source: "source", sourcePath: "/workspace/source.slang", sourceUri: "file:///workspace/source.slang", workspace: { rootUri: "file:///workspace/source.slang", files: [{ path: "/workspace/source.slang", uri: "file:///workspace/source.slang", source: "source" }] }, options: {} };
    await compiler.compile(request);
    expect(fakeCompiler.compile).toHaveBeenCalledWith(request);
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
    expect(fetch).toHaveBeenCalledWith(
      "https://file+.vscode-resource.vscode-cdn.net/Users/test/extension/ui-dist/assets/slangCompileWorker.js",
      { signal: expect.anything() },
    );
    expect(fetch).toHaveBeenCalledWith("s.js", { signal: expect.anything() });
    expect(fetch).toHaveBeenCalledWith("s.wasm", { signal: expect.anything() });
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

      expect(fetch).toHaveBeenCalledWith("missing-worker.js", { signal: expect.anything() });
      expect(workerCreate).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][1]).toEqual(new Error("Failed to load Slang worker asset (404)"));
      expect(loadSlangModuleMock).toHaveBeenCalledWith("s.js", "s.wasm");
      expect(compiler).toEqual({ kind: "main-thread", inner: { kind: "slang-compiler", slang: { slangModule: true } } });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it.each([
    ["worker script", 1],
    ["Slang script", 2],
    ["Slang WASM", 3],
  ])("stops after a disposed %s fetch and revokes every accumulated URL", async (_label, fetchCount) => {
    vi.stubGlobal("Worker", FakeWorker);
    const requests: Array<{
      url: string;
      response: ReturnType<typeof deferred<Response>>;
      signal: AbortSignal | undefined;
    }> = [];
    vi.mocked(fetch).mockImplementation((input, init) => {
      if (requests.length >= fetchCount) {
        throw new Error("Unexpected fetch after disposal");
      }
      const response = deferred<Response>();
      requests.push({ url: String(input), response, signal: init?.signal ?? undefined });
      return response.promise;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
    const compiling = createCompiler(engine).then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );

    for (let index = 0; index < fetchCount; index++) {
      await vi.waitFor(() => expect(requests).toHaveLength(index + 1));
      if (index === fetchCount - 1) {
        engine.dispose();
        expect(requests[index].signal?.aborted).toBe(true);
      }
      requests[index].response.resolve(assetResponse(requests[index].url));
    }

    const { error } = await compiling;
    expect(error).toEqual(new Error("Engine disposed"));
    expect(fetch).toHaveBeenCalledTimes(fetchCount);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(fetchCount);
    expect(workerCreate).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(loadSlangModuleMock).not.toHaveBeenCalled();
  });

  it("checks disposal immediately before worker initialization", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
    vi.mocked(URL.createObjectURL)
      .mockReset()
      .mockReturnValueOnce("blob:slang-worker")
      .mockReturnValueOnce("blob:slang-js")
      .mockImplementationOnce(() => {
        engine.dispose();
        return "blob:slang-wasm";
      });

    await expect(createCompiler(engine)).rejects.toThrow("Engine disposed");

    expect(workerCreate).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(loadSlangModuleMock).not.toHaveBeenCalled();
  });

  it("does not warn or fall back when disposal lands in the worker failure path", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const workerResult = deferred<unknown>();
    workerCreate.mockReturnValue(workerResult.promise);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
    const compiling = createCompiler(engine);
    await vi.waitFor(() => expect(workerCreate).toHaveBeenCalledOnce());

    engine.dispose();
    workerResult.reject(new Error("worker stopped"));

    await expect(compiling).rejects.toThrow("Engine disposed");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(loadSlangModuleMock).not.toHaveBeenCalled();
  });

  it("disposes a worker compiler that resolves after disposal", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const workerResult = deferred<{ compile: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>();
    const lateCompiler = { compile: vi.fn(), dispose: vi.fn() };
    workerCreate.mockReturnValue(workerResult.promise);
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
    const compiling = createCompiler(engine);
    await vi.waitFor(() => expect(workerCreate).toHaveBeenCalledOnce());

    engine.dispose();
    workerResult.resolve(lateCompiler);

    await expect(compiling).rejects.toThrow("Engine disposed");
    expect(lateCompiler.dispose).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(loadSlangModuleMock).not.toHaveBeenCalled();
  });

  it("does not begin main-thread loading after disposal", async () => {
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    engine.dispose();

    await expect(createCompiler(engine)).rejects.toThrow("Engine disposed");
    expect(loadSlangModuleMock).not.toHaveBeenCalled();
    expect(mainThreadCtor).not.toHaveBeenCalled();
  });

  it("does not construct a main-thread compiler when disposal lands during module loading", async () => {
    const slangResult = deferred<unknown>();
    loadSlangModuleMock.mockReturnValueOnce(slangResult.promise);
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    const compiling = createCompiler(engine);
    await vi.waitFor(() => expect(loadSlangModuleMock).toHaveBeenCalledOnce());

    engine.dispose();
    slangResult.resolve({ slangModule: true });

    await expect(compiling).rejects.toThrow("Engine disposed");
    expect(mainThreadCtor).not.toHaveBeenCalled();
  });

  it("disposes a main-thread compiler if construction itself disposes the engine", async () => {
    const lateCompiler = { compile: vi.fn(), dispose: vi.fn() };
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm" });
    mainThreadCtor.mockImplementationOnce(function (this: unknown) {
      engine.dispose();
      return lateCompiler;
    });

    await expect(createCompiler(engine)).rejects.toThrow("Engine disposed");
    expect(lateCompiler.dispose).toHaveBeenCalledOnce();
  });

  it("revokes worker object URLs even when the inner compiler dispose throws", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const disposeError = new Error("worker dispose failed");
    workerCreate.mockResolvedValue({
      compile: vi.fn(),
      dispose: vi.fn(() => {
        throw disposeError;
      }),
    });
    const engine = new WebGPURenderingEngine({ scriptUrl: "s.js", wasmUrl: "s.wasm", workerUrl: "worker.js" });
    const compiler = await createCompiler(engine);

    expect(() => compiler.dispose()).toThrow(disposeError);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
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
