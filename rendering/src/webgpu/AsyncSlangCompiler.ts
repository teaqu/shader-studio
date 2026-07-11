import type { SlangCompiler, SlangCompileOptions, SlangCompileResult } from "./SlangCompiler";

/**
 * Async facade over Slang→WGSL compilation. The engine awaits compile() and
 * keeps rendering the previous pipelines meanwhile — the same
 * keep-old-while-compiling pattern the WebGL engine gets from
 * KHR_parallel_shader_compile, with a worker instead of the driver.
 */
export interface AsyncSlangCompiler {
  compile(source: string, options: SlangCompileOptions): Promise<SlangCompileResult>;
  dispose(): void;
}

/** Fallback: compile on the main thread with the in-process slang-wasm. */
export class MainThreadSlangCompiler implements AsyncSlangCompiler {
  constructor(private readonly inner: SlangCompiler) {}

  async compile(source: string, options: SlangCompileOptions): Promise<SlangCompileResult> {
    return this.inner.compileImagePass(source, options);
  }

  dispose(): void {}
}

type WorkerResponse =
  | { id: number; ok: true; result?: SlangCompileResult }
  | { id: number; ok: false; error: string };

type Pending = {
  resolve: (result: SlangCompileResult) => void;
  isInit: boolean;
  initResolve?: () => void;
  initReject?: (error: Error) => void;
};

/** Proxy to a dedicated worker owning its own slang-wasm instance. */
export class WorkerSlangCompiler implements AsyncSlangCompiler {
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private disposed = false;

  private constructor(private readonly worker: Worker) {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (entry.isInit) {
        if (msg.ok) entry.initResolve!();
        else entry.initReject!(new Error(msg.error));
        return;
      }
      if (msg.ok && msg.result) entry.resolve(msg.result);
      else entry.resolve({ success: false, errors: [msg.ok ? "Slang worker returned no result" : msg.error] });
    };
    this.worker.onerror = () => {
      this.failAllPending("Slang worker crashed");
    };
  }

  static async create(
    workerFactory: () => Worker,
    scriptUrl: string,
    wasmUrl: string,
    initTimeoutMs = 30000,
  ): Promise<WorkerSlangCompiler> {
    const worker = workerFactory();
    const instance = new WorkerSlangCompiler(worker);
    const id = instance.nextId++;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Slang worker init timed out")), initTimeoutMs);
        instance.pending.set(id, {
          isInit: true,
          resolve: () => {},
          initResolve: () => { clearTimeout(timer); resolve(); },
          initReject: (error) => { clearTimeout(timer); reject(error); },
        });
        worker.postMessage({ id, type: "init", scriptUrl, wasmUrl });
      });
    } catch (error) {
      worker.terminate();
      throw error;
    }
    return instance;
  }

  compile(source: string, options: SlangCompileOptions): Promise<SlangCompileResult> {
    if (this.disposed) {
      return Promise.resolve({ success: false, errors: ["Slang worker disposed"] });
    }
    const id = this.nextId++;
    return new Promise<SlangCompileResult>((resolve) => {
      this.pending.set(id, { resolve, isInit: false });
      this.worker.postMessage({ id, type: "compile", source, options });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.failAllPending("Slang worker disposed");
    this.worker.terminate();
  }

  private failAllPending(message: string): void {
    for (const [, entry] of this.pending) {
      if (entry.isInit) entry.initReject?.(new Error(message));
      else entry.resolve({ success: false, errors: [message] });
    }
    this.pending.clear();
  }
}
