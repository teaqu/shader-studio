import { describe, it, expect, vi } from "vitest";
import { MainThreadSlangCompiler, WorkerSlangCompiler } from "../../webgpu/AsyncSlangCompiler";
import type { SlangCompileRequest } from "../../webgpu/SlangCompiler";

const request: SlangCompileRequest = {
  source: "src",
  sourceUri: "file:///project/image.slang",
  sourcePath: "/workspace/image.slang",
  workspace: {
    rootUri: "file:///project",
    files: [{ uri: "file:///project/lib.slang", path: "/workspace/lib.slang", source: "dependency" }],
  },
  options: { passName: "Image" },
};

function compileRequest(source: string, options: SlangCompileRequest["options"] = {}): SlangCompileRequest {
  return {
    ...request,
    source,
    workspace: {
      ...request.workspace,
      files: [{ uri: request.sourceUri, path: request.sourcePath, source }],
    },
    options,
  };
}

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
  it("forwards the same serializable request used by the worker contract", async () => {
    const inner = { compile: vi.fn(() => ({ success: true as const, wgsl: "w", diagnostics: [] })) };
    const compiler = new MainThreadSlangCompiler(inner as any);

    await compiler.compile(request);

    expect(inner.compile).toHaveBeenCalledWith(request);
  });
  it("delegates to the wrapped SlangCompiler", async () => {
    const inner = { compile: vi.fn(() => ({ success: true as const, wgsl: "w", diagnostics: [] })) };
    const compiler = new MainThreadSlangCompiler(inner as any);
    const input = compileRequest("src", { passName: "Image" });
    const result = await compiler.compile(input);
    expect(result).toEqual({ success: true, wgsl: "w", diagnostics: [] });
    expect(inner.compile).toHaveBeenCalledWith(input);
  });
});

describe("WorkerSlangCompiler", () => {
  it("posts the complete compile request without reshaping its workspace", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const pending = compiler.compile(request);

    expect(worker.posted[1]).toEqual({ id: 1, type: "compile", request });
    worker.emit({ id: 1, ok: true, result: { success: true, wgsl: "w", diagnostics: [] } });
    await pending;
  });
  it("initializes the worker and round-trips a compile by id", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    expect(worker.posted[0]).toMatchObject({ type: "init", scriptUrl: "s.js", wasmUrl: "s.wasm" });
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const input = compileRequest("src", { passName: "BufferA" });
    const compilePromise = compiler.compile(input);
    expect(worker.posted[1]).toMatchObject({ type: "compile", request: input });
    worker.emit({ id: worker.posted[1].id, ok: true, result: { success: true, wgsl: "w", diagnostics: [] } });
    await expect(compilePromise).resolves.toEqual({ success: true, wgsl: "w", diagnostics: [] });
  });

  it("matches concurrent compiles to their own responses by id", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const a = compiler.compile(compileRequest("srcA"));
    const b = compiler.compile(compileRequest("srcB"));
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

  it("converts a compile-message error into a failed result", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const compilePromise = compiler.compile(compileRequest("src"));
    worker.emit({ id: worker.posted[1].id, ok: false, error: "worker exploded" });
    await expect(compilePromise).resolves.toEqual({ success: false, errors: ["worker exploded"], diagnostics: [] });
  });

  it("dispose() terminates the worker and fails pending compiles", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const pending = compiler.compile(compileRequest("src"));
    compiler.dispose();
    expect(worker.terminate).toHaveBeenCalled();
    await expect(pending).resolves.toEqual({ success: false, errors: ["Slang worker unavailable"], diagnostics: [] });
  });

  it("fails pending compiles when the worker itself errors", async () => {
    const worker = fakeWorker();
    const createPromise = WorkerSlangCompiler.create(() => worker as any, "s.js", "s.wasm");
    worker.emit({ id: worker.posted[0].id, ok: true });
    const compiler = await createPromise;

    const pending = compiler.compile(compileRequest("src"));
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
    const result = await compiler.compile(compileRequest("src"));

    expect(result).toEqual({ success: false, errors: ["Slang worker unavailable"], diagnostics: [] });
    expect(worker.postMessage).toHaveBeenCalledTimes(postedBeforeNewCompile);
  });
});
