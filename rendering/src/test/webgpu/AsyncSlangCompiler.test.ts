import { describe, it, expect, vi } from "vitest";
import { MainThreadSlangCompiler, WorkerSlangCompiler } from "../../webgpu/AsyncSlangCompiler";

const request = (languageVersion?: "legacy" | "2025" | "2026" | "latest") => ({
  source: "src", sourceUri: "file:///workspace/image.slang", sourcePath: "/workspace/image.slang",
  workspace: { rootUri: "file:///workspace/image.slang", files: [{ path: "/workspace/image.slang", uri: "file:///workspace/image.slang", source: "src" }] },
  options: { ...(languageVersion ? { languageVersion } : {}) },
});

/** Fake Worker capturing posted messages; test drives responses via emit(). */
function fakeWorker() {
  const posted: any[] = [];
  const worker = {
    posted,
    onmessage: null as ((event: { data: any }) => void) | null,
    onerror: null as ((event: unknown) => void) | null,
    postMessage: vi.fn((msg: any) => posted.push(msg)),
    terminate: vi.fn(),
    emit(data: any) {
      this.onmessage?.({ data });
    },
  };
  return worker;
}

describe("MainThreadSlangCompiler", () => {
  it("delegates to the wrapped SlangCompiler", async () => {
    const inner = { compile: vi.fn(() => ({ success: true as const, wgsl: "w", diagnostics: [] })) };
    const compiler = new MainThreadSlangCompiler(inner as any);
    const input = request("2026");
    const result = await compiler.compile(input);
    expect(result).toEqual({ success: true, wgsl: "w", diagnostics: [] });
    expect(inner.compile).toHaveBeenCalledWith(input);
  });

  it("disposes the wrapped main-thread compiler", () => {
    const inner = { compile: vi.fn(), dispose: vi.fn() };
    new MainThreadSlangCompiler(inner as any).dispose();
    expect(inner.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "legacy", "2025", "2026", "latest"] as const)("preserves %s requests without mutation", async (version) => {
    const input = request(version);
    const before = structuredClone(input);
    const inner = { compile: vi.fn(() => ({ success: true as const, wgsl: "w", diagnostics: [] })) };
    await new MainThreadSlangCompiler(inner as any).compile(input);
    expect(inner.compile).toHaveBeenCalledWith(input);
    expect(input).toEqual(before);
  });
});

describe("WorkerSlangCompiler", () => {
  it("initializes the worker and round-trips a compile by id", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    expect(worker.posted[0]).toMatchObject({ type: "init", scriptUrl: "s.js", wasmUrl: "s.wasm" });
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const input = request("2025");
    const compilePromise = compiler.compile(input);
    expect(worker.posted[1]).toEqual({ id: worker.posted[1].id, type: "compile", request: input });
    worker.emit({ id: worker.posted[1].id, ok: true, result: { success: true, wgsl: "w", diagnostics: [] } });
    await expect(compilePromise).resolves.toEqual({ success: true, wgsl: "w", diagnostics: [] });
  });

  it.each([undefined, "legacy", "2025", "2026", "latest"] as const)("posts the complete %s request unchanged", async (version) => {
    const worker = fakeWorker();
    const init = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await init;
    const input = request(version);
    const before = structuredClone(input);
    const pending = compiler.compile(input);
    const message = worker.posted.at(-1);
    expect(message).toEqual({ id: message.id, type: "compile", request: input });
    worker.emit({ id: message.id, ok: true, result: { success: true, wgsl: "w", diagnostics: [{ message: "note" }] } });
    await expect(pending).resolves.toEqual({ success: true, wgsl: "w", diagnostics: [{ message: "note" }] });
    expect(input).toEqual(before);
  });

  it("matches concurrent compiles to their own responses by id", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const a = compiler.compile({ ...request(), source: "srcA" });
    const b = compiler.compile({ ...request(), source: "srcB" });
    // Answer B first, then A.
    worker.emit({ id: worker.posted[2].id, ok: true, result: { success: true, wgsl: "B" } });
    worker.emit({ id: worker.posted[1].id, ok: true, result: { success: true, wgsl: "A" } });
    await expect(b).resolves.toEqual({ success: true, wgsl: "B" });
    await expect(a).resolves.toEqual({ success: true, wgsl: "A" });
  });

  it("rejects create() when worker init reports an error", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: false, error: "wasm blocked" });
    await expect(createPromise).rejects.toThrow("wasm blocked");
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("reports worker status messages while initializing", async () => {
    const worker = fakeWorker();
    const onStatus = vi.fn();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm", 30000, onStatus);

    worker.emit({ type: "status", label: "boot" });
    worker.emit({ type: "status", label: "init-received", id: worker.posted[0].id });
    worker.emit({ id: worker.posted[0].id, ok: true });
    await createPromise;

    expect(onStatus).toHaveBeenCalledWith({ type: "status", label: "boot" });
    expect(onStatus).toHaveBeenCalledWith({ type: "status", label: "init-received", id: worker.posted[0].id });
  });

  it("rejects create() when the worker factory throws", async () => {
    await expect(
      WorkerSlangCompiler.create(() => {
        throw new Error("no Worker");
      }, "s.js", "s.wasm"),
    ).rejects.toThrow("no Worker");
  });

  it("cleans pending init and terminates when init postMessage throws", async () => {
    const worker = fakeWorker();
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("init clone failed");
    });
    await expect(WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm")).rejects.toThrow("init clone failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("converts a compile-message error into a failed result", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const compilePromise = compiler.compile(request());
    worker.emit({ id: worker.posted[1].id, ok: false, error: "worker exploded" });
    await expect(compilePromise).resolves.toEqual({ success: false, errors: ["worker exploded"], diagnostics: [] });
  });

  it("dispose() terminates the worker and fails pending compiles", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const pending = compiler.compile(request());
    compiler.dispose();
    expect(worker.terminate).toHaveBeenCalled();
    await expect(pending).resolves.toEqual({ success: false, errors: ["Slang worker unavailable"], diagnostics: [] });
  });

  it("terminates a worker only once when dispose is repeated", async () => {
    const worker = fakeWorker();
    const creating = WorkerSlangCompiler.create(() => worker as unknown as Worker, "slang.js", "slang.wasm");
    worker.onmessage!({ data: { id: 0, ok: true } } as MessageEvent);
    const compiler = await creating;
    compiler.dispose();
    compiler.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("fails pending compiles when the worker itself errors", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const pending = compiler.compile(request());
    worker.onerror?.(new Event("error"));
    await expect(pending).resolves.toEqual({ success: false, errors: ["Slang worker crashed"], diagnostics: [] });
  });

  it("marks the compiler unavailable after a crash so future compiles fail fast instead of hanging", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    worker.onerror?.(new Event("error"));
    const postedBeforeNewCompile = worker.postMessage.mock.calls.length;

    // A NEW compile() issued after the crash must resolve immediately as a
    // failure rather than posting into the dead worker and hanging forever
    // (which would otherwise wedge callers like ShaderProcessor.isProcessing).
    const result = await compiler.compile(request());

    expect(result).toEqual({ success: false, errors: ["Slang worker unavailable"], diagnostics: [] });
    expect(worker.postMessage).toHaveBeenCalledTimes(postedBeforeNewCompile);
  });

  it("turns a synchronous postMessage failure into a result without leaking pending work", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error("clone failed");
    });
    await expect(compiler.compile(request("2026"))).resolves.toEqual({ success: false, errors: ["clone failed"], diagnostics: [] });
    const next = compiler.compile(request("latest"));
    worker.emit({ id: worker.posted.at(-1).id, ok: true, result: { success: true, wgsl: "ok", diagnostics: [] } });
    await expect(next).resolves.toEqual({ success: true, wgsl: "ok", diagnostics: [] });
  });
});
