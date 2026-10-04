import type { ShaderLanguageId } from "@shader-studio/types";
import { MainThreadSlangCompiler,WorkerSlangCompiler,type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import { SlangCompiler } from "./SlangCompiler";
import { loadSlangModule } from "./SlangModuleLoader";
import type { BlobAssetUrl,SlangAssetUrls } from "./WebGPUCompilationTypes";
import type { WebGPUCompileDiagnostics } from "./WebGPUCompileDiagnostics";
import { WgslCompiler } from "./WgslCompiler";

const SLANG_WORKER_INIT_TIMEOUT_MS = 1500;

class RevokingAsyncSlangCompiler implements AsyncSlangCompiler {
  constructor(
    private readonly inner: AsyncSlangCompiler,
    private readonly objectUrls: string[],
  ) {}

  compile(source: string, options: Parameters<AsyncSlangCompiler["compile"]>[1]): Promise<ReturnType<AsyncSlangCompiler["compile"]> extends Promise<infer T> ? T : never> {
    return this.inner.compile(source, options);
  }

  dispose(): void {
    try {
      this.inner.dispose();
    } finally {
      this.revokeObjectUrls();
    }
  }

  private revokeObjectUrls(): void {
    for (const url of this.objectUrls.splice(0)) {
      URL.revokeObjectURL(url);
    }
  }
}

interface WebGPUCompilerLoaderHost {
  diagnostics: Pick<WebGPUCompileDiagnostics, "logSlangPerf" | "ms" | "now">;
  language: ShaderLanguageId;
  slangAssets?: SlangAssetUrls;
  disposed: boolean;
}

/** Owns compilerLoader state and operations; dependencies stay live across compilation swaps. */
export class WebGPUCompilerLoader {
  constructor(private readonly host: WebGPUCompilerLoaderHost) {}

  compilerAbortController: AbortController | null = null;

  async createCompiler(): Promise<AsyncSlangCompiler> {
    this.assertNotDisposed();
    if (this.host.language === "wgsl") {
      // The WGSL front end needs no worker, WASM, or asset URLs at all.
      return new WgslCompiler();
    }
    const abortController = new AbortController();
    this.compilerAbortController = abortController;
    const slangAssets = this.host.slangAssets;
    if (!slangAssets) {
      throw new Error("Slang asset URLs are required for Slang compilation");
    }
    const { scriptUrl, wasmUrl, workerUrl } = slangAssets;
    const startedAt = this.host.diagnostics.now();
    try {
      if (workerUrl && typeof Worker !== "undefined") {
        const objectUrls: string[] = [];
        const revokeObjectUrls = () => {
          for (const url of objectUrls.splice(0)) {
            URL.revokeObjectURL(url);
          }
        };
        try {
          this.host.diagnostics.logSlangPerf("worker fetch start", { workerUrl });
          const workerScript = await this.createBlobAssetUrl(
            workerUrl,
            "text/javascript",
            "text",
            abortController.signal,
          );
          objectUrls.push(workerScript.url);
          this.assertNotDisposed();
          const slangScript = await this.createBlobAssetUrl(
            scriptUrl,
            "text/javascript",
            "text",
            abortController.signal,
          );
          objectUrls.push(slangScript.url);
          this.assertNotDisposed();
          const slangWasm = await this.createBlobAssetUrl(
            wasmUrl,
            "application/wasm",
            "binary",
            abortController.signal,
          );
          objectUrls.push(slangWasm.url);
          this.assertNotDisposed();
          this.host.diagnostics.logSlangPerf("worker fetch complete", {
            workerUrl,
            fetchMs: this.host.diagnostics.ms(workerScript.fetchMs + slangScript.fetchMs + slangWasm.fetchMs),
            blobMs: this.host.diagnostics.ms(workerScript.blobMs + slangScript.blobMs + slangWasm.blobMs),
          });
          const initStartedAt = this.host.diagnostics.now();
          this.assertNotDisposed();
          this.host.diagnostics.logSlangPerf("worker init start", { workerUrl });
          const compiler = await WorkerSlangCompiler.create(
            () => new Worker(workerScript.url, { type: "module" }),
            slangScript.url,
            slangWasm.url,
            SLANG_WORKER_INIT_TIMEOUT_MS,
            (status) => this.host.diagnostics.logSlangPerf("worker status", { workerUrl, ...status }),
          );
          if (this.host.disposed) {
            this.disposeLateCompiler(compiler);
          }
          this.host.diagnostics.logSlangPerf("worker setup", {
            mode: "worker",
            workerUrl,
            initTimeoutMs: SLANG_WORKER_INIT_TIMEOUT_MS,
            fetchMs: this.host.diagnostics.ms(workerScript.fetchMs + slangScript.fetchMs + slangWasm.fetchMs),
            blobMs: this.host.diagnostics.ms(workerScript.blobMs + slangScript.blobMs + slangWasm.blobMs),
            initMs: this.host.diagnostics.ms(this.host.diagnostics.now() - initStartedAt),
            totalMs: this.host.diagnostics.ms(this.host.diagnostics.now() - startedAt),
          });
          return new RevokingAsyncSlangCompiler(compiler, objectUrls);
        } catch (e) {
          revokeObjectUrls();
          if (this.host.disposed) {
            throw this.engineDisposedError();
          }
          console.warn("[Slang] worker compiler unavailable, compiling on main thread:", e);
        }
      }

      this.assertNotDisposed();
      const mainThreadStartedAt = this.host.diagnostics.now();
      this.host.diagnostics.logSlangPerf("main-thread setup start", { workerUrl: workerUrl ?? null });
      const slang = await loadSlangModule(scriptUrl, wasmUrl);
      this.assertNotDisposed();
      this.host.diagnostics.logSlangPerf("worker setup", {
        mode: "main-thread",
        workerUrl: workerUrl ?? null,
        loadSlangMs: this.host.diagnostics.ms(this.host.diagnostics.now() - mainThreadStartedAt),
        totalMs: this.host.diagnostics.ms(this.host.diagnostics.now() - startedAt),
      });
      const compiler = new MainThreadSlangCompiler(new SlangCompiler(slang));
      if (this.host.disposed) {
        this.disposeLateCompiler(compiler);
      }
      return compiler;
    } finally {
      if (this.compilerAbortController === abortController) {
        this.compilerAbortController = null;
      }
    }
  }

  assertNotDisposed(): void {
    if (this.host.disposed) {
      throw this.engineDisposedError();
    }
  }

  disposeLateCompiler(compiler: AsyncSlangCompiler): never {
    try {
      compiler.dispose();
    } finally {
      throw this.engineDisposedError();
    }
  }

  engineDisposedError(): Error {
    return new Error("Engine disposed");
  }

  async createBlobAssetUrl(
    resourceUrl: string,
    mimeType: string,
    mode: "text" | "binary",
    signal: AbortSignal,
  ): Promise<BlobAssetUrl> {
    const fetchStartedAt = this.host.diagnostics.now();
    const response = await fetch(resourceUrl, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load Slang worker asset (${response.status})`);
    }
    const source = mode === "text" ? await response.text() : await response.arrayBuffer();
    const fetchMs = this.host.diagnostics.now() - fetchStartedAt;
    const blobStartedAt = this.host.diagnostics.now();
    const url = URL.createObjectURL(new Blob([source], { type: mimeType }));
    return { url, fetchMs, blobMs: this.host.diagnostics.now() - blobStartedAt };
  }
  abortLoading(): void {
    const controller = this.compilerAbortController;
    this.compilerAbortController = null;
    controller?.abort();
  }

}
