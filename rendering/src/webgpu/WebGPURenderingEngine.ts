/// <reference types="@webgpu/types" />
import type { ShaderConfig, SlangDiagnostic, SlangWorkspaceSnapshot } from "@shader-studio/types";
import type { CompilationResult, PassUniforms } from "../models";
import type { RenderingEngine } from "../types/RenderingEngine";
import type {
  IVariableCapturer,
  CaptureUniforms,
  CaptureCompileContext,
  CaptureCustomUniform,
} from "../capture/VariableCapturer";
import { WebGPUVariableCapturer } from "./WebGPUVariableCapturer";
import { TimeManager } from "../util/TimeManager";
import { MouseManager } from "../input/MouseManager";
import { KeyboardManager } from "../input/KeyboardManager";
import { CameraManager } from "../input/CameraManager";
import { FPSCalculator } from "../util/FPSCalculator";
import {
  SlangCompiler,
  type SlangCompileRequest,
  type SlangCompileTargetName,
  type SlangTargetCompileResult,
} from "./SlangCompiler";
import { loadSlangModule } from "./SlangModuleLoader";
import { MainThreadSlangCompiler, WorkerSlangCompiler, type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import {
  createSlangCustomUniformLayout,
  packShaderToyUniforms,
  type ShaderToyUniformInput,
} from "./uniforms";
import { CustomUniformManager, type CustomUniform } from "../webgl/CustomUniformManager";
import { ConfigValidator } from "../util/ConfigValidator";
import { buildSlangPassGraph, resolvePassResolution, type RenderPassNode } from "./SlangPassGraph";
import { SlangPassPipeline, type SlangChannelResource } from "./SlangPassPipeline";
import { createSlangWgslCacheKey, sharedSlangWgslCache } from "./SlangWgslCache";
import { WebGPUTextureBackend, type WebGPUTextureHandle } from "./WebGPUTextureBackend";
import { ResourceManager } from "../resources/ResourceManager";

export interface SlangAssetUrls {
  scriptUrl: string;
  wasmUrl: string;
  /** URL of the compiled slangCompileWorker chunk; absent → main-thread compile. */
  workerUrl?: string;
  /** Emit Slang timing diagnostics to the webview console. */
  debugTimings?: boolean;
}

interface BlobAssetUrl {
  url: string;
  fetchMs: number;
  blobMs: number;
}

interface PassTiming {
  name: string;
  cacheHit: boolean;
  wgslCacheHit?: boolean;
  totalMs?: number;
  slangMs?: number;
  pipelineMs?: number;
  errorCount?: number;
}

const SLANG_WORKER_INIT_TIMEOUT_MS = 1500;
const DEFAULT_MAX_TEXTURE_DIMENSION_2D = 8192;

function cloneWorkspace(workspace: SlangWorkspaceSnapshot): SlangWorkspaceSnapshot {
  return { rootUri: workspace.rootUri, files: workspace.files.map((file) => ({ ...file })) };
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    );
  }
  return value;
}

function cloneShaderConfig(config: ShaderConfig): ShaderConfig {
  return cloneJsonValue(config) as ShaderConfig;
}

function targetFailure(...errors: string[]): SlangTargetCompileResult {
  return { success: false, errors, diagnostics: [] };
}

function workspaceCandidates(workspace: SlangWorkspaceSnapshot, selector: string | undefined, topLevelPath: string) {
  if (!selector) {
    return [];
  }
  const rootFile = workspace.files.find((file) => file.uri === workspace.rootUri);
  const rootPath = rootFile?.path;
  const relative = !selector.startsWith("/") && !selector.includes("://");
  const internal = relative ? `/workspace/${selector.replace(/\\/g, "/").replace(/^\.\//, "")}` : selector;
  const rootBase = rootFile ? workspace.rootUri.slice(0, workspace.rootUri.lastIndexOf("/") + 1) : `${workspace.rootUri.replace(/\/$/, "")}/`;
  const windowsPath = /^[a-z]:[\\/]/i.test(selector);
  const uri = selector.includes("://") ? selector : windowsPath ? `file:///${selector.replace(/\\/g, "/").replace(/^([a-z]):/i, (_, drive) => `${drive.toLowerCase()}:`)}` : relative ? new URL(selector.replace(/\\/g, "/"), rootBase).href : selector.startsWith("/") ? `file://${encodeURIComponent(selector).replace(/%2F/g, "/")}` : undefined;
  const topLevel = selector === topLevelPath ? [topLevelPath, `file://${encodeURI(topLevelPath)}`] : [];
  const values = new Set([selector, internal, uri, ...topLevel].filter(Boolean).map((value) => String(value).replace(/^file:\/\/\/([A-Z]):/i, (_, drive) => `file:///${drive.toLowerCase()}:`)));
  return workspace.files.filter((file) => values.has(file.path) || values.has(file.uri.replace(/^file:\/\/\/([A-Z]):/i, (_, drive) => `file:///${drive.toLowerCase()}:`)));
}

class RevokingAsyncSlangCompiler implements AsyncSlangCompiler {
  constructor(
    private readonly inner: AsyncSlangCompiler,
    private readonly objectUrls: string[],
  ) {}

  compile(request: SlangCompileRequest): Promise<ReturnType<AsyncSlangCompiler["compile"]> extends Promise<infer T> ? T : never> {
    return this.inner.compile(request);
  }

  compileTarget(
    request: SlangCompileRequest,
    target: SlangCompileTargetName,
  ): Promise<SlangTargetCompileResult> {
    return this.inner.compileTarget(request, target);
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

/**
 * WebGPU/Slang counterpart to the WebGL RenderingEngine. Supports multi-pass
 * rendering driven by the ShaderToy-style Slang convention (iTime,
 * iResolution, iMouse, iFrame): BufferA-D passes render to float ping-pong
 * textures that other passes sample via iChannelN, and the Image pass renders
 * to the canvas. Inline Slang debugging, pixel inspection (async readback),
 * variable capture, texture inputs, video inputs, cubemap inputs, audio inputs,
 * and keyboard inputs are supported.
 */
export class WebGPURenderingEngine implements RenderingEngine {
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private ready: Promise<void> | null = null;
  private initError: string | null = null;
  private maxTextureDimension2D = DEFAULT_MAX_TEXTURE_DIMENSION_2D;

  private compiler: AsyncSlangCompiler | null = null;
  private compilerAbortController: AbortController | null = null;
  private resourceManager: ResourceManager<WebGPUTextureHandle> | null = null;
  /** Managers owned by in-flight replacement compiles, never exposed to rendering. */
  private candidateResourceManagers = new Set<ResourceManager<WebGPUTextureHandle>>();

  private passGraph: RenderPassNode[] = [];
  private passPipelines = new Map<string, SlangPassPipeline>();
  private passKeys = new Map<string, string>();
  private shaderPath = "";
  private lastCompile: {
    code: string;
    path: string;
    buffers: Record<string, string>;
    customUniformDeclarations?: string;
    customUniformInfo?: { name: string; type: string }[];
    workspace?: SlangWorkspaceSnapshot;
  } | null = null;
  private lastCompileAttempt: {
    code: string;
    config: ShaderConfig | null;
    path: string;
    buffers: Record<string, string>;
    customUniformInfo: { name: string; type: string }[];
    workspace?: SlangWorkspaceSnapshot;
  } | null = null;
  private customUniformManager = new CustomUniformManager();
  private pendingCustomUniformValues: CustomUniform[] | null = null;
  /**
   * Bumped on every compileShaderPipeline call. Concurrent compiles aren't
   * serialized upstream (BufferUpdater is fire-and-forget, worker compiles
   * can take seconds), so an older attempt can finish after a newer one
   * already installed its pipelines. Comparing the captured generation
   * against this counter right before the install swap lets a late-arriving
   * older attempt detect it's been superseded and bail instead of clobbering
   * the newer, already-live pipelines.
   */
  private compileGeneration = 0;
  private disposed = false;
  private reloadOnNextApply = false;

  // Pixel inspector readback. WebGPU readback is async, so readPixel()
  // records the wanted coordinate and returns the last resolved pixel;
  // render() encodes a 1×1 copy of the canvas texture each frame while a
  // coordinate is requested and no mapping is in flight.
  private inspectorTarget: { x: number; y: number } | null = null;
  private inspectorPixel: { r: number; g: number; b: number; a: number } | null = null;
  private inspectorReadbackBuffer: GPUBuffer | null = null;
  private inspectorReadbackPending = false;
  private inspectorCopyEncoded = false;
  private capturePassName: string | null = null;

  private timeManager = new TimeManager();
  private mouseManager = new MouseManager();
  private keyboardManager = new KeyboardManager();
  private cameraManager = new CameraManager(this.keyboardManager);
  private fps = new FPSCalculator(60, 10);
  private currentConfig: ShaderConfig | null = null;
  private running = false;
  private rafId: number | null = null;
  private fpsLimit = 0;
  private lastRenderedAt: number | null = null;
  private frameTimeBuffer: number[] = new Array(3600);
  private frameTimeHead = 0;
  private frameTimeLen = 0;
  private frameTimeCount = 0;
  private previousFrameTimestamp: number | null = null;
  private lastCameraTimestamp: number | null = null;
  private static readonly MAX_FRAME_TIME_HISTORY = 3600;

  // WebGL pause parity (see FrameRenderer): while paused, per-frame uniform
  // inputs are frozen at the values captured when the pause began, so mouse
  // movement can't keep driving a "paused" shader.
  private pausedUniformInput: Pick<
    ShaderToyUniformInput,
    "time" | "timeDelta" | "frameRate" | "frame" | "mouse" | "date" | "cameraPos" | "cameraDir"
  > | null = null;

  constructor(private slangAssets: SlangAssetUrls) {}

  private createResourceManager(): ResourceManager<WebGPUTextureHandle> {
    if (!this.device) {
      throw new Error("Cannot create resources before WebGPU initialization");
    }
    return new ResourceManager(new WebGPUTextureBackend(this.device));
  }

  initialize(glCanvas: HTMLCanvasElement, _preserveDrawingBuffer = false): void {
    if (this.disposed) {
      return;
    }

    const initStartedAt = this.now();
    this.logSlangPerf("init start", {
      canvasWidth: glCanvas.width,
      canvasHeight: glCanvas.height,
    });
    this.canvas = glCanvas;
    let ctx: GPUCanvasContext | null = null;
    try {
      ctx = glCanvas.getContext("webgpu");
    } catch {
      ctx = null;
    }
    if (!ctx) {
      this.initError = "WebGPU is not available in this runtime (no webgpu context)";
      this.logSlangPerf("init failed", {
        reason: this.initError,
        totalMs: this.ms(this.now() - initStartedAt),
      });
      return;
    }
    this.context = ctx;
    this.mouseManager.setupEventListeners(glCanvas);
    this.keyboardManager.setupEventListeners();
    this.cameraManager.setupEventListeners(glCanvas);
    this.ready = this.initDevice(initStartedAt);
  }

  private async initDevice(initStartedAt = this.now()): Promise<void> {
    try {
      if (!navigator.gpu) {
        throw new Error("navigator.gpu is undefined");
      }
      const adapterStartedAt = this.now();
      this.logSlangPerf("adapter request start", {});
      const adapter = await navigator.gpu.requestAdapter();
      const adapterMs = this.now() - adapterStartedAt;
      if (this.disposed) {
        return;
      }
      if (!adapter) {
        throw new Error("requestAdapter() returned null");
      }
      const deviceStartedAt = this.now();
      this.logSlangPerf("device request start", {});
      const deviceDescriptor = this.buildDeviceDescriptor(adapter);
      const device = deviceDescriptor
        ? await adapter.requestDevice(deviceDescriptor)
        : await adapter.requestDevice();
      const deviceMs = this.now() - deviceStartedAt;
      if (this.disposed) {
        device.destroy?.();
        return;
      }
      this.device = device;
      this.maxTextureDimension2D = this.resolveDeviceTextureLimit(device);
      this.clampCanvasToTextureLimit();
      this.resourceManager = this.createResourceManager();
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.logSlangPerf("context configure", { format: this.format });
      // COPY_SRC lets the pixel inspector read back from the canvas texture.
      const RENDER_ATTACHMENT = globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10;
      const COPY_SRC = globalThis.GPUTextureUsage?.COPY_SRC ?? 0x01;
      this.context!.configure({
        device,
        format: this.format,
        alphaMode: "opaque",
        usage: RENDER_ATTACHMENT | COPY_SRC,
      });

      const compilerStartedAt = this.now();
      this.logSlangPerf("compiler create start", {});
      const compiler = await this.createCompiler();
      if (this.disposed) {
        compiler.dispose();
        return;
      }
      this.compiler = compiler;
      this.logSlangPerf("init complete", {
        adapterMs: this.ms(adapterMs),
        deviceMs: this.ms(deviceMs),
        compilerMs: this.ms(this.now() - compilerStartedAt),
        totalMs: this.ms(this.now() - initStartedAt),
      });
    } catch (e) {
      if (this.disposed) {
        return;
      }
      this.initError = e instanceof Error ? e.message : String(e);
      this.logSlangPerf("init failed", {
        reason: this.initError,
        totalMs: this.ms(this.now() - initStartedAt),
      });
    }
  }

  private buildDeviceDescriptor(adapter: GPUAdapter): GPUDeviceDescriptor | undefined {
    const adapterLimit = adapter.limits?.maxTextureDimension2D;
    if (
      typeof adapterLimit === "number" &&
      Number.isFinite(adapterLimit) &&
      adapterLimit > DEFAULT_MAX_TEXTURE_DIMENSION_2D
    ) {
      return {
        requiredLimits: {
          maxTextureDimension2D: adapterLimit,
        },
      };
    }
    return undefined;
  }

  private resolveDeviceTextureLimit(device: GPUDevice): number {
    const deviceLimit = device.limits?.maxTextureDimension2D;
    if (typeof deviceLimit === "number" && Number.isFinite(deviceLimit) && deviceLimit > 0) {
      return Math.floor(deviceLimit);
    }
    return DEFAULT_MAX_TEXTURE_DIMENSION_2D;
  }

  private clampDimensionToTextureLimit(value: number): number {
    const rounded = Math.round(value);
    if (!Number.isFinite(rounded)) {
      return 1;
    }
    return Math.min(Math.max(1, rounded), this.maxTextureDimension2D);
  }

  private clampCanvasToTextureLimit(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.width = this.clampDimensionToTextureLimit(this.canvas.width);
    this.canvas.height = this.clampDimensionToTextureLimit(this.canvas.height);
  }

  private clampResolutionToTextureLimit(resolution: { width: number; height: number }): { width: number; height: number } {
    return {
      width: this.clampDimensionToTextureLimit(resolution.width),
      height: this.clampDimensionToTextureLimit(resolution.height),
    };
  }

  /** Prefer a worker-hosted compiler; fall back to main-thread slang-wasm. */
  private async createCompiler(): Promise<AsyncSlangCompiler> {
    this.assertNotDisposed();
    const abortController = new AbortController();
    this.compilerAbortController = abortController;
    const { scriptUrl, wasmUrl, workerUrl } = this.slangAssets;
    const startedAt = this.now();
    try {
      if (workerUrl && typeof Worker !== "undefined") {
        const objectUrls: string[] = [];
        const revokeObjectUrls = () => {
          for (const url of objectUrls.splice(0)) {
            URL.revokeObjectURL(url);
          }
        };
        try {
          this.logSlangPerf("worker fetch start", { workerUrl });
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
          this.logSlangPerf("worker fetch complete", {
            workerUrl,
            fetchMs: this.ms(workerScript.fetchMs + slangScript.fetchMs + slangWasm.fetchMs),
            blobMs: this.ms(workerScript.blobMs + slangScript.blobMs + slangWasm.blobMs),
          });
          const initStartedAt = this.now();
          this.assertNotDisposed();
          this.logSlangPerf("worker init start", { workerUrl });
          const compiler = await WorkerSlangCompiler.create(
            () => new Worker(workerScript.url, { type: "module" }),
            slangScript.url,
            slangWasm.url,
            SLANG_WORKER_INIT_TIMEOUT_MS,
            (status) => this.logSlangPerf("worker status", { workerUrl, ...status }),
          );
          if (this.disposed) {
            this.disposeLateCompiler(compiler);
          }
          this.logSlangPerf("worker setup", {
            mode: "worker",
            workerUrl,
            initTimeoutMs: SLANG_WORKER_INIT_TIMEOUT_MS,
            fetchMs: this.ms(workerScript.fetchMs + slangScript.fetchMs + slangWasm.fetchMs),
            blobMs: this.ms(workerScript.blobMs + slangScript.blobMs + slangWasm.blobMs),
            initMs: this.ms(this.now() - initStartedAt),
            totalMs: this.ms(this.now() - startedAt),
          });
          return new RevokingAsyncSlangCompiler(compiler, objectUrls);
        } catch (e) {
          revokeObjectUrls();
          if (this.disposed) {
            throw this.engineDisposedError();
          }
          console.warn("[Slang] worker compiler unavailable, compiling on main thread:", e);
        }
      }

      this.assertNotDisposed();
      const mainThreadStartedAt = this.now();
      this.logSlangPerf("main-thread setup start", { workerUrl: workerUrl ?? null });
      const slang = await loadSlangModule(scriptUrl, wasmUrl);
      this.assertNotDisposed();
      this.logSlangPerf("worker setup", {
        mode: "main-thread",
        workerUrl: workerUrl ?? null,
        loadSlangMs: this.ms(this.now() - mainThreadStartedAt),
        totalMs: this.ms(this.now() - startedAt),
      });
      const compiler = new MainThreadSlangCompiler(new SlangCompiler(slang));
      if (this.disposed) {
        this.disposeLateCompiler(compiler);
      }
      return compiler;
    } finally {
      if (this.compilerAbortController === abortController) {
        this.compilerAbortController = null;
      }
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw this.engineDisposedError();
    }
  }

  private disposeLateCompiler(compiler: AsyncSlangCompiler): never {
    try {
      compiler.dispose();
    } finally {
      throw this.engineDisposedError();
    }
  }

  private engineDisposedError(): Error {
    return new Error("Engine disposed");
  }

  private async createBlobAssetUrl(
    resourceUrl: string,
    mimeType: string,
    mode: "text" | "binary",
    signal: AbortSignal,
  ): Promise<BlobAssetUrl> {
    const fetchStartedAt = this.now();
    const response = await fetch(resourceUrl, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load Slang worker asset (${response.status})`);
    }
    const source = mode === "text" ? await response.text() : await response.arrayBuffer();
    const fetchMs = this.now() - fetchStartedAt;
    const blobStartedAt = this.now();
    const url = URL.createObjectURL(new Blob([source], { type: mimeType }));
    return { url, fetchMs, blobMs: this.now() - blobStartedAt };
  }

  async compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string> = {},
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
    workspace?: SlangWorkspaceSnapshot,
  ): Promise<CompilationResult | undefined> {
    if (this.disposed) {
      return { success: false, errors: ["Engine disposed"], superseded: true };
    }
    // Captured synchronously (before any await) so concurrent calls made in
    // the same tick still get distinct, call-order-correct generations.
    const generation = ++this.compileGeneration;
    this.lastCompileAttempt = {
      code,
      config: config ? cloneShaderConfig(config) : null,
      path,
      buffers: { ...buffers },
      customUniformInfo: customUniformInfo?.map((uniform) => ({ ...uniform })) ?? [],
      workspace: workspace ? cloneWorkspace(workspace) : undefined,
    };
    // WebGL parity: the config is remembered even when invalid, but an
    // invalid one fails the compile before any Slang work starts.
    if (config) {
      const validation = ConfigValidator.validateConfig(config);
      if (!validation.isValid) {
        return this.failedCompilation(path, generation, {
          success: false,
          errors: [`Invalid shader configuration: ${validation.errors.join(", ")}`],
        });
      }
    }
    const startedAt = this.now();
    let readyMs = 0;
    this.logSlangPerf("compile requested", {
      path,
      generation,
      hasReady: Boolean(this.ready),
      hasContext: Boolean(this.context),
      hasDevice: Boolean(this.device),
      hasCompiler: Boolean(this.compiler),
    });
    // Remember the inputs so updateBufferAndRecompile can re-run this compile
    // with a single buffer's content patched.
    const compileWorkspace = workspace ? cloneWorkspace(workspace) : undefined;
    const nextCustomUniformManager = new CustomUniformManager();
    if (customUniformDeclarations && customUniformInfo) {
      nextCustomUniformManager.loadDeclarations(customUniformDeclarations, customUniformInfo);
      if (this.pendingCustomUniformValues) {
        nextCustomUniformManager.updateValues(this.pendingCustomUniformValues);
      }
    }
    if (this.ready) {
      const readyStartedAt = this.now();
      this.logSlangPerf("compile waiting for init", { path, generation });
      await this.ready;
      readyMs = this.now() - readyStartedAt;
      this.logSlangPerf("compile init ready", { path, generation, readyMs: this.ms(readyMs) });
    }

    if (generation !== this.compileGeneration || this.disposed) {
      return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
    }

    if (this.initError || !this.device || !this.compiler) {
      const reason = this.initError ?? this.describeUnavailableInitState();
      this.logSlangPerf("compile unavailable", { path, generation, reason });
      return this.failedCompilation(path, generation, {
        success: false,
        errors: [`WebGPU init failed: ${reason}`],
      });
    }

    this.clampCanvasToTextureLimit();
    const graphStartedAt = this.now();
    const graph = buildSlangPassGraph({
      imageCode: code,
      config,
      buffers,
      canvasWidth: this.canvas?.width ?? 1,
      canvasHeight: this.canvas?.height ?? 1,
    });
    const graphMs = this.now() - graphStartedAt;

    if (graph.errors.length > 0) {
      this.logCompileTiming("failed", {
        path,
        generation,
        startedAt,
        readyMs,
        graphMs,
        passTimings: [],
        graph,
        errors: graph.errors,
      });
      return this.failedCompilation(path, generation, {
        success: false,
        errors: graph.errors,
        warnings: graph.warnings,
      });
    }
    for (const pass of graph.passes) {
      const resolution = this.clampResolutionToTextureLimit(pass);
      pass.width = resolution.width;
      pass.height = resolution.height;
    }

    // WebGL parity (ShaderPipeline.updateResources): file-backed inputs are
    // loaded (and awaited) as part of the compile; render then only does cache
    // lookups.
    // A replacement must never mutate the manager that backs the currently
    // installed shader.  Loading media is asynchronous and can fail or be
    // superseded, so give path switches and explicit reloads their own owner
    // until the pipeline generation has committed atomically.
    const replacesResources = this.shaderPath !== "" && (
      this.shaderPath !== path || this.reloadOnNextApply
    );
    const previousResourceManager = this.resourceManager;
    const resourceManager = replacesResources
      ? this.createResourceManager()
      : previousResourceManager;
    const candidateResourceManager = replacesResources ? resourceManager : null;
    if (candidateResourceManager) {
      this.candidateResourceManagers.add(candidateResourceManager);
    }
    let candidateCleaned = false;
    const cleanupCandidate = () => {
      if (!candidateResourceManager || candidateCleaned) {
        return;
      }
      // dispose() clears this set after it has cleaned every in-flight owner.
      // A late async loader must not clean that manager a second time.
      if (!this.candidateResourceManagers.has(candidateResourceManager)) {
        candidateCleaned = true;
        return;
      }
      candidateCleaned = true;
      this.candidateResourceManagers.delete(candidateResourceManager);
      candidateResourceManager.cleanup();
    };
    const abandonCandidate = <T>(result: T): T => {
      cleanupCandidate();
      return result;
    };
    if (resourceManager) {
      const interruptedResourceCompile = (): CompilationResult | null => {
        if (this.disposed || generation !== this.compileGeneration) {
          try {
            cleanupCandidate();
          } catch { /* Disposal owns cleanup errors. */ }
          return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
        }
        return null;
      };
      for (const pass of graph.passes) {
        for (const channel of pass.channels) {
          if (channel.kind === "texture") {
            try {
              await resourceManager.loadImageTexture(channel.path, {
                filter: channel.filter,
                wrap: channel.wrap,
                vflip: channel.vflip,
                grayscale: channel.grayscale,
              });
            } catch (error) {
              const interrupted = interruptedResourceCompile();
              if (interrupted) {
                return interrupted;
              }
              cleanupCandidate();
              throw error;
            }
            const interrupted = interruptedResourceCompile();
            if (interrupted) {
              return interrupted;
            }
          } else if (channel.kind === "video") {
            let result;
            try {
              result = await resourceManager.loadVideoTexture(channel.path, {
                filter: channel.filter,
                wrap: channel.wrap,
                vflip: channel.vflip,
                muted: channel.muted,
              });
            } catch (error) {
              const interrupted = interruptedResourceCompile();
              if (interrupted) {
                return interrupted;
              }
              cleanupCandidate();
              throw error;
            }
            const interrupted = interruptedResourceCompile();
            if (interrupted) {
              return interrupted;
            }
            if (result.warning) {
              graph.warnings.push(result.warning);
            }
          } else if (channel.kind === "cubemap") {
            try {
              await resourceManager.loadCubemapTexture(channel.path, {
                filter: channel.filter,
                wrap: channel.wrap,
                vflip: channel.vflip,
              });
            } catch (error) {
              const interrupted = interruptedResourceCompile();
              if (interrupted) {
                return interrupted;
              }
              cleanupCandidate();
              throw error;
            }
            const interrupted = interruptedResourceCompile();
            if (interrupted) {
              return interrupted;
            }
          } else if (channel.kind === "audio") {
            try {
              await resourceManager.loadAudioSource(channel.path, {
                muted: channel.muted,
                startTime: channel.startTime,
                endTime: channel.endTime,
              });
              const interrupted = interruptedResourceCompile();
              if (interrupted) {
                return interrupted;
              }
              resourceManager.updateAudioLoopRegion(
                channel.path,
                channel.startTime,
                channel.endTime,
              );
            } catch {
              const interrupted = interruptedResourceCompile();
              if (interrupted) {
                return interrupted;
              }
              graph.warnings.push(`Audio loading failed: ${channel.path}`);
            }
          }
        }
      }
    }

    const nextPipelines = new Map<string, SlangPassPipeline>();
    const nextKeys = new Map<string, string>();
    const pendingWgslCacheEntries: Array<{ key: string; wgsl: string; diagnostics: SlangDiagnostic[] }> = [];
    const passTimings: PassTiming[] = [];
    const errors: string[] = [];
    const diagnostics: SlangDiagnostic[] = [];
    const passRequests = new Map<RenderPassNode, SlangCompileRequest>();
    for (const pass of graph.passes) {
      const request = this.createCompileRequest(pass, graph.commonCode, nextCustomUniformManager.getUniformInfo(), path, compileWorkspace);
      if (!request) {
        errors.push(`${pass.name}: Workspace does not uniquely identify ${pass.path ?? path}`);
      } else {
        passRequests.set(pass, request);
      }
    }
    if (errors.length) {
      return abandonCandidate(this.failedCompilation(path, generation, { success: false, errors, warnings: graph.warnings }));
    }
    for (const pass of graph.passes) {
      const passStartedAt = this.now();
      const request = passRequests.get(pass)!;
      const key = `${path}\u0000${createSlangWgslCacheKey(request)}`;
      const existing = this.passPipelines.get(pass.name);
      if (existing && this.passKeys.get(pass.name) === key) {
        // Unchanged pass: carry the live pipeline into the next generation.
        // Resize (if the canvas changed) is deferred to the success block so
        // this loop stays mutation-free while a later pass can still fail.
        nextPipelines.set(pass.name, existing);
        nextKeys.set(pass.name, key);
        passTimings.push({
          name: pass.name,
          cacheHit: true,
          totalMs: this.ms(this.now() - passStartedAt),
        });
        continue;
      }
      let pipeline: SlangPassPipeline | undefined;
      try {
        const cached = sharedSlangWgslCache.getEntry(key);
        let wgsl = cached?.wgsl ?? null;
        const wgslCacheHit = cached !== null;
        let slangMs = 0;
        if (cached) {
          diagnostics.push(...cached.diagnostics);
        }
        if (!wgsl) {
          const slangStartedAt = this.now();
          const compiled = await this.compiler.compile(request);
          slangMs = this.now() - slangStartedAt;
          diagnostics.push(...(compiled.diagnostics ?? []));
          if (!compiled.success) {
            errors.push(...compiled.errors.map((error) => `${pass.name}: ${error}`));
            passTimings.push({
              name: pass.name,
              cacheHit: false,
              wgslCacheHit: false,
              slangMs: this.ms(slangMs),
              totalMs: this.ms(this.now() - passStartedAt),
              errorCount: compiled.errors.length,
            });
            continue;
          }
          wgsl = compiled.wgsl;
          pendingWgslCacheEntries.push({ key, wgsl, diagnostics: compiled.diagnostics ?? [] });
        }
        pipeline = new SlangPassPipeline(this.device, this.format, {
          name: pass.name,
          width: pass.width,
          height: pass.height,
          output: pass.output,
          channels: pass.channels.map((channel) => ({
            slot: channel.slot,
            key: channel.key,
            kind: channel.kind,
          })),
          uniformBufferSize: createSlangCustomUniformLayout(
            nextCustomUniformManager.getUniformInfo(),
          ).size,
        });
        const pipelineStartedAt = this.now();
        const wgslErrors = await pipeline.rebuild(wgsl);
        const pipelineMs = this.now() - pipelineStartedAt;
        errors.push(...wgslErrors);
        passTimings.push({
          name: pass.name,
          cacheHit: false,
          wgslCacheHit,
          slangMs: this.ms(slangMs),
          pipelineMs: this.ms(pipelineMs),
          totalMs: this.ms(this.now() - passStartedAt),
          errorCount: wgslErrors.length,
        });
        nextPipelines.set(pass.name, pipeline);
        nextKeys.set(pass.name, key);
      } catch (error) {
        // rebuild() may throw mid-way through constructing GPU resources;
        // dispose whatever this pipeline managed to create before re-throwing
        // as a compile error.
        pipeline?.dispose();
        errors.push(`${pass.name}: ${error instanceof Error ? error.message : String(error)}`);
        passTimings.push({
          name: pass.name,
          cacheHit: false,
          totalMs: this.ms(this.now() - passStartedAt),
          errorCount: 1,
        });
      }
    }

    if (errors.length > 0) {
      // Dispose only pipelines built THIS attempt; carried-over pipelines are
      // still installed in this.passPipelines and actively rendering, so they
      // must survive a failed recompile untouched.
      for (const [name, pipeline] of nextPipelines) {
        if (pipeline !== this.passPipelines.get(name)) {
          pipeline.dispose();
        }
      }
      this.logCompileTiming("failed", {
        path,
        generation,
        startedAt,
        readyMs,
        graphMs,
        passTimings,
        graph,
        errors,
      });
      return abandonCandidate(this.failedCompilation(path, generation, {
        success: false,
        errors,
        warnings: graph.warnings,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      }));
    }

    if (generation !== this.compileGeneration || this.disposed) {
      // A newer compileShaderPipeline call (or dispose()) already landed
      // while this attempt was awaiting the compiler/worker. Installing now
      // would clobber the newer, already-live pipelines with stale ones, so
      // drop this attempt: dispose only the pipelines built THIS attempt
      // (carried-over ones are — or were — still installed and must survive
      // untouched).
      for (const [name, pipeline] of nextPipelines) {
        if (pipeline !== this.passPipelines.get(name)) {
          pipeline.dispose();
        }
      }
      this.logCompileTiming("superseded", {
        path,
        generation,
        startedAt,
        readyMs,
        graphMs,
        passTimings,
        graph,
        errors: ["Superseded by a newer compile"],
      });
      return abandonCandidate({ success: false, errors: ["Superseded by a newer compile"], superseded: true });
    }

    // Success: resize carried-over pipelines to the new graph dimensions
    // (width/height don't affect the cache key, so a canvas resize alone
    // wouldn't have recompiled them), then dispose replaced/removed
    // pipelines and swap in the new generation atomically.
    for (const pass of graph.passes) {
      const pipeline = nextPipelines.get(pass.name);
      if (pipeline && pipeline === this.passPipelines.get(pass.name)) {
        pipeline.resize(pass.width, pass.height);
      }
    }
    for (const [name, pipeline] of this.passPipelines) {
      if (nextPipelines.get(name) !== pipeline) {
        pipeline.dispose();
      }
    }
    if (this.pendingCustomUniformValues) {
      nextCustomUniformManager.updateValues(this.pendingCustomUniformValues);
    }
    const switchedShader = this.shaderPath !== "" && this.shaderPath !== path;
    let retiredResourceManager: ResourceManager<WebGPUTextureHandle> | null = null;
    if (candidateResourceManager) {
      this.resourceManager = candidateResourceManager;
      this.candidateResourceManagers.delete(candidateResourceManager);
      if (previousResourceManager && previousResourceManager !== candidateResourceManager) {
        retiredResourceManager = previousResourceManager;
      }
      this.reloadOnNextApply = false;
    }
    if (switchedShader) {
      this.timeManager.cleanup();
    }
    this.customUniformManager = nextCustomUniformManager;
    this.currentConfig = config;
    for (const entry of pendingWgslCacheEntries) {
      sharedSlangWgslCache.set(entry.key, entry.wgsl, entry.diagnostics);
    }
    this.passGraph = graph.passes;
    this.passPipelines = nextPipelines;
    this.passKeys = nextKeys;
    this.shaderPath = path;
    this.lastCompile = {
      code, path, buffers: { ...buffers }, customUniformDeclarations,
      customUniformInfo: customUniformInfo?.map((uniform) => ({ ...uniform })),
      workspace: compileWorkspace ? cloneWorkspace(compileWorkspace) : undefined,
    };
    // Retiring an old media owner is best-effort: its teardown must not undo
    // an already committed replacement generation.
    try {
      retiredResourceManager?.cleanup();
    } catch (error) {
      console.warn("[Slang] failed to clean replaced resources", error);
    }
    // Correct any canvas resize that landed mid-compile immediately, rather
    // than leaving passes stale until the next resize/recompile.
    this.applyPassResolutions();

    // WebGL parity (RenderingEngine.compileShaderPipeline): newly loaded video
    // textures load with autoplay disabled, so without this they'd sit frozen
    // on their first frame until some other action resumed them. Sync to the
    // current shader time and start/hold playback based on pause state.
    if (this.resourceManager) {
      const shaderTime = this.timeManager.getCurrentTime(performance.now());
      this.resourceManager.syncAllVideosToTime?.(shaderTime);
      if (this.timeManager.isPaused()) {
        this.resourceManager.pauseAllVideos?.();
      } else {
        this.resourceManager.resumeAllVideos?.();
      }
    }

    this.logCompileTiming("success", {
      path,
      generation,
      startedAt,
      readyMs,
      graphMs,
      passTimings,
      graph,
      errors,
    });
    return {
      success: true,
      warnings: graph.warnings.length > 0 ? graph.warnings : undefined,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    };
  }

  async compileImageTarget(
    target: SlangCompileTargetName,
  ): Promise<SlangTargetCompileResult> {
    const attempt = this.lastCompileAttempt;
    if (!attempt) {
      return targetFailure("Cannot export before a shader has been requested");
    }
    if (this.disposed) {
      return targetFailure("Engine disposed");
    }
    if (this.ready) {
      await this.ready;
    }
    if (this.disposed) {
      return targetFailure("Engine disposed");
    }
    if (this.initError || !this.compiler) {
      const reason = this.initError ?? this.describeUnavailableInitState();
      return targetFailure(`WebGPU init failed: ${reason}`);
    }

    const graph = buildSlangPassGraph({
      imageCode: attempt.code,
      config: attempt.config,
      buffers: attempt.buffers,
      canvasWidth: this.canvas?.width ?? 1,
      canvasHeight: this.canvas?.height ?? 1,
    });
    if (graph.errors.length) {
      return targetFailure(...graph.errors);
    }
    const image = graph.passes.find((pass) => pass.name === "Image");
    if (!image) {
      return targetFailure("Slang export could not find the Image pass");
    }
    const request = this.createCompileRequest(
      image,
      graph.commonCode,
      attempt.customUniformInfo,
      attempt.path,
      attempt.workspace,
    );
    if (!request) {
      return targetFailure(
        `Workspace does not uniquely identify ${image.path ?? attempt.path}`,
      );
    }
    try {
      return await this.compiler.compileTarget(request, target);
    } catch (error) {
      return targetFailure(error instanceof Error ? error.message : String(error));
    }
  }

  private failedCompilation(
    path: string,
    generation: number,
    result: CompilationResult,
  ): CompilationResult {
    if (generation !== this.compileGeneration || this.disposed) {
      return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
    }

    return result;
  }

  private beginShaderSession(path: string): void {
    const hadInstalledPipeline = this.passPipelines.size > 0;
    for (const pipeline of this.passPipelines.values()) {
      pipeline.dispose();
    }
    this.passPipelines.clear();
    this.passKeys.clear();
    this.passGraph = [];
    if (hadInstalledPipeline) {
      this.resourceManager?.cleanup();
      this.timeManager.cleanup();
    }
    this.shaderPath = path;
    this.clearCanvas();
  }

  private clearCanvas(): void {
    if (!this.device || !this.context) {
      return;
    }

    try {
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    } catch {
      // Preserve the original compilation error if the surface is unavailable
      // while the renderer is already failing or being replaced.
    }
  }

  private logCompileTiming(
    status: "success" | "failed" | "superseded",
    details: {
      path: string;
      generation: number;
      startedAt: number;
      readyMs: number;
      graphMs: number;
      passTimings: PassTiming[];
      graph: { passes: RenderPassNode[]; warnings: string[] };
      errors: string[];
    },
  ): void {
    const totalMs = this.ms(this.now() - details.startedAt);
    const cacheHits = details.passTimings.filter((pass) => pass.cacheHit).length;
    const passSummary = details.passTimings
      .map((pass) => {
        if (pass.cacheHit) {
          return `${pass.name}:cache ${pass.totalMs ?? 0}ms`;
        }
        const pieces = [`${pass.name}:compile ${pass.totalMs ?? 0}ms`];
        if (pass.wgslCacheHit) {
          pieces.push("wgsl-cache");
        } else if (pass.slangMs !== undefined) {
          pieces.push(`slang ${pass.slangMs}ms`);
        }
        if (pass.pipelineMs !== undefined) {
          pieces.push(`pipeline ${pass.pipelineMs}ms`);
        }
        if (pass.errorCount !== undefined && pass.errorCount > 0) {
          pieces.push(`errors ${pass.errorCount}`);
        }
        return pieces.join(" ");
      })
      .join(" | ");
    const readyMs = this.ms(details.readyMs);
    const compileWorkMs = this.ms(Math.max(0, totalMs - details.readyMs));
    this.logSlangPerf("compile", {
      status,
      path: details.path,
      generation: details.generation,
      totalMs,
      readyMs,
      compileWorkMs,
      graphMs: this.ms(details.graphMs),
      passCount: details.graph.passes.length,
      cacheHits,
      compiledPasses: details.passTimings
        .filter((pass) => !pass.cacheHit)
        .map((pass) => pass.name),
      passSummary,
      passes: details.passTimings,
      warningCount: details.graph.warnings.length,
      errorCount: details.errors.length,
    });
    if (this.slangAssets.debugTimings) {
      console.log(
        "[SlangPerf] compile summary",
        `${status} ${details.path} total=${totalMs}ms ready=${readyMs}ms work=${compileWorkMs}ms passes=${details.graph.passes.length} cacheHits=${cacheHits} :: ${passSummary}`,
      );
    }
  }

  private logSlangPerf(event: string, data: Record<string, unknown>): void {
    if (this.slangAssets.debugTimings) {
      console.log(`[SlangPerf] ${event}`, data);
    }
  }

  private now(): number {
    return performance.now();
  }

  private ms(value: number): number {
    return Number(value.toFixed(2));
  }

  private describeUnavailableInitState(): string {
    if (!this.ready && !this.context && !this.device && !this.compiler) {
      return "engine was not initialized";
    }

    return [
      "device unavailable",
      `ready=${Boolean(this.ready)}`,
      `context=${Boolean(this.context)}`,
      `device=${Boolean(this.device)}`,
      `compiler=${Boolean(this.compiler)}`,
    ].join(" ");
  }

  private createCompileRequest(
    pass: RenderPassNode,
    commonCode: string,
    customUniforms: { name: string; type: string }[] = [],
    path: string,
    supplied?: SlangWorkspaceSnapshot,
  ): SlangCompileRequest | null {
    const passPath = pass.name === "Image" ? path : pass.path ?? path;
    const fallbackName = passPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "image.slang";
    const fallbackPath = passPath.startsWith("/workspace/") ? passPath : `/workspace/${fallbackName}`;
    const fallbackUri = passPath.includes("://") ? passPath : `file://${encodeURIComponent(passPath.replace(/\\/g, "/")).replace(/%2F/g, "/")}`;
    const workspace = supplied ? cloneWorkspace(supplied) : {
      rootUri: fallbackUri,
      files: [{ path: fallbackPath, uri: fallbackUri, source: pass.source }],
    };
    const selector = pass.name === "Image" ? path : pass.path;
    const candidates = supplied ? workspaceCandidates(workspace, selector, path) : workspace.files;
    let root = candidates.length === 1 ? candidates[0] : undefined;
    if (candidates.length > 1) {
      return null;
    }
    if (!root && pass.name === "Image") {
      const sourceMatches = workspace.files.filter((file) => file.source === pass.source);
      if (sourceMatches.length === 1) {
        root = sourceMatches[0];
      }
    }
    if (!root) {
      return null;
    }
    root.source = pass.source;
    return {
      source: pass.source, sourceUri: root.uri, sourcePath: root.path, workspace,
      options: {
        passName: pass.name, commonCode,
        channels: pass.channels.map((channel) => ({ slot: channel.slot, key: channel.key, kind: channel.kind })),
        ...(customUniforms.length ? { customUniforms } : {}),
      },
    };
  }

  render(time: number = performance.now()): void {
    this.renderFrame(time, false);
  }

  private renderFrame(time: number, capture: boolean): void {
    if (!this.device || !this.context || this.passGraph.length === 0) {
      return;
    }
    if (!capture && !this.shouldRenderFrame(time)) {
      return;
    }

    const isPaused = this.timeManager.isPaused();

    if (!capture) {
      this.timeManager.updateFrame(time);

      // Skip duplicate frames from VS Code multi-panel rendering (but allow
      // the first frame, whose delta is synthetic anyway) — WebGL parity.
      if (this.timeManager.getDeltaTime() === 0 && this.timeManager.getFrame() !== 0) {
        return;
      }

      if (!isPaused) {
        this.fps.updateFrame(time);
      }

      this.resourceManager?.updateAudioTextures?.();

      const cameraDelta = this.lastCameraTimestamp === null
        ? 0
        : (time - this.lastCameraTimestamp) / 1000;
      this.lastCameraTimestamp = time;
      this.cameraManager.update(cameraDelta);
    }

    // WebGL pause parity: freeze the per-frame uniform inputs at the values
    // captured when the pause began, so e.g. mouse movement can't keep
    // driving a "paused" shader.
    if (isPaused && this.pausedUniformInput === null) {
      this.pausedUniformInput = {
        time: this.timeManager.getCurrentTime(time),
        timeDelta: this.timeManager.getDeltaTime(),
        frameRate: this.fps.getRawFPS(),
        frame: this.timeManager.getFrame(),
        mouse: Array.from(this.mouseManager.getMouse()),
        date: Array.from(this.timeManager.getCurrentDate()),
        cameraPos: Array.from(this.cameraManager.getCameraPos()),
        cameraDir: Array.from(this.cameraManager.getCameraDir()),
      };
    } else if (!isPaused) {
      this.pausedUniformInput = null;
    }

    const frameInput = this.pausedUniformInput ?? {
      time: this.timeManager.getCurrentTime(time),
      timeDelta: this.timeManager.getDeltaTime(),
      frameRate: this.fps.getRawFPS(),
      frame: this.timeManager.getFrame(),
      mouse: this.mouseManager.getMouse(),
      date: this.timeManager.getCurrentDate(),
      cameraPos: this.cameraManager.getCameraPos(),
      cameraDir: this.cameraManager.getCameraDir(),
    };

    // While paused, buffer passes stop advancing. Frame 0 is the exception:
    // a shader loaded while paused still renders its first buffer state.
    const skipBufferPasses = isPaused && this.timeManager.getFrame() > 0;

    const encoder = this.device.createCommandEncoder();
    let canvasTexture: GPUTexture | null = null;

    for (const pass of this.passGraph) {
      if (skipBufferPasses && pass.output === "texture") {
        continue;
      }
      const pipeline = this.passPipelines.get(pass.name);
      if (!pipeline?.getPipeline() || !pipeline.getUniformBuffer()) {
        continue;
      }

      // All-or-nothing: the pass's WGSL was compiled against its full channel
      // list, so if any channel source is unresolvable this frame, binding the
      // survivors positionally would mis-bind them. Skip the pass entirely.
      const channelResources = this.getChannelResources(pass, isPaused);
      if (channelResources === null) {
        continue;
      }

      // Channel passes have no bind group until the first rebuildBindGroup:
      // their explicit layout requires the channel texture/sampler entries,
      // so it must be (re)built before the bind-group presence check.
      if (channelResources.length > 0) {
        pipeline.rebuildBindGroup(channelResources);
      }
      const bindGroup = pipeline.getBindGroup();
      if (!bindGroup) {
        continue;
      }

      const data = packShaderToyUniforms({
        width: pass.width,
        height: pass.height,
        ...frameInput,
        ...this.getChannelUniforms(pass),
      }, this.customUniformManager.getUniformInfo(), this.customUniformManager.getCurrentValues());
      this.device.queue.writeBuffer(pipeline.getUniformBuffer()!, 0, data);

      const targetView = pass.output === "canvas"
        ? (canvasTexture = this.context.getCurrentTexture()).createView()
        : pipeline.getCurrentOutputView();
      if (!targetView) {
        continue;
      }

      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      renderPass.setPipeline(pipeline.getPipeline()!);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(3);
      renderPass.end();
    }

    this.encodeInspectorCopy(encoder, canvasTexture);
    this.device.queue.submit([encoder.finish()]);
    this.resolveInspectorReadback();

    if (!skipBufferPasses) {
      for (const pass of this.passGraph) {
        if (pass.output === "texture") {
          this.passPipelines.get(pass.name)?.swap();
        }
      }
    }

    if (!capture) {
      this.recordFrameTime(time);
      this.keyboardManager.clearPressed();
      if (!isPaused) {
        this.timeManager.incrementFrame();
      }
    }
  }

  private shouldRenderFrame(time: number): boolean {
    if (this.fpsLimit > 0 && this.lastRenderedAt !== null) {
      const minFrameInterval = 1000 / this.fpsLimit;
      const elapsed = time - this.lastRenderedAt;
      if (elapsed < minFrameInterval * 0.9) {
        return false;
      }

      this.lastRenderedAt += minFrameInterval;
      if (this.lastRenderedAt < time - minFrameInterval) {
        this.lastRenderedAt = time;
      }
      return true;
    }

    this.lastRenderedAt = time;
    return true;
  }

  private recordFrameTime(time: number): void {
    if (this.timeManager.isPaused()) {
      this.previousFrameTimestamp = null;
      return;
    }

    if (this.previousFrameTimestamp !== null) {
      const frameDelta = time - this.previousFrameTimestamp;
      if (frameDelta < 500) {
        this.frameTimeBuffer[this.frameTimeHead] = frameDelta;
        this.frameTimeHead = (this.frameTimeHead + 1) % WebGPURenderingEngine.MAX_FRAME_TIME_HISTORY;
        if (this.frameTimeLen < WebGPURenderingEngine.MAX_FRAME_TIME_HISTORY) {
          this.frameTimeLen++;
        }
        this.frameTimeCount++;
      }
    }
    this.previousFrameTimestamp = time;
  }

  /**
   * Resolve every channel of a pass to a texture view. Returns null if ANY
   * channel is unresolvable (missing source pipeline or view): the pass's
   * shader was compiled against the full channel list, so a partial bind
   * group would attach surviving channels at the wrong bindings.
   */
  private getChannelResources(
    pass: RenderPassNode,
    skipInputUpdates = false,
  ): SlangChannelResource[] | null {
    const resources: SlangChannelResource[] = [];
    for (const channel of pass.channels) {
      if (channel.kind === "buffer") {
        const source = this.passPipelines.get(channel.source);
        const textureView = channel.readFrom === "previous-frame"
          ? source?.getPreviousOutputView()
          : source?.getCurrentOutputView();
        if (!textureView) {
          return null;
        }
        resources.push({ slot: channel.slot, textureView });
      } else if (channel.kind === "texture") {
        const handle = this.resourceManager?.getImageTextureCache()[channel.path]
          ?? this.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({ slot: channel.slot, textureView: handle.view, sampler: handle.sampler });
      } else if (channel.kind === "video") {
        const handle = this.resourceManager?.getVideoTexture(channel.path)
          ?? this.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({ slot: channel.slot, textureView: handle.view, sampler: handle.sampler });
      } else if (channel.kind === "cubemap") {
        const handle = this.resourceManager?.getCubemapTexture(channel.path);
        if (!handle) {
          return null;
        }
        resources.push({ slot: channel.slot, textureView: handle.view, sampler: handle.sampler });
      } else if (channel.kind === "audio") {
        const handle = this.resourceManager?.getAudioTexture(channel.path)
          ?? this.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({ slot: channel.slot, textureView: handle.view, sampler: handle.sampler });
      } else {
        const handle = this.resolveKeyboardHandle(skipInputUpdates);
        if (!handle) {
          return null;
        }
        resources.push({ slot: channel.slot, textureView: handle.view, sampler: handle.sampler });
      }
    }
    return resources;
  }

  private getChannelUniforms(
    pass: RenderPassNode,
  ): {
    channelTime: number[];
    channelLoaded: number[];
    sampleRate: number;
    channelResolution: number[];
  } {
    const channelTime = [0, 0, 0, 0];
    const channelLoaded = [0, 0, 0, 0];
    const channelResolution = new Array<number>(12).fill(0);

    for (const channel of pass.channels) {
      if (channel.slot > 3) {
        continue;
      }

      if (channel.kind === "video") {
        const video = this.resourceManager?.getVideoElement?.(channel.path);
        const handle = this.resourceManager?.getVideoTexture?.(channel.path);
        if (video) {
          channelTime[channel.slot] = video.currentTime;
          channelLoaded[channel.slot] = 1;
        }
        this.setChannelResolution(channelResolution, channel.slot, handle?.width, handle?.height);
      } else if (channel.kind === "audio") {
        const state = this.resourceManager?.getAudioState?.(channel.path);
        if (state) {
          channelTime[channel.slot] = state.currentTime;
          channelLoaded[channel.slot] = 1;
        }
        this.setChannelResolution(channelResolution, channel.slot, 512, 2);
      } else if (channel.kind === "texture") {
        const handle = this.resourceManager?.getImageTextureCache?.()[channel.path];
        channelLoaded[channel.slot] = handle ? 1 : 0;
        this.setChannelResolution(channelResolution, channel.slot, handle?.width, handle?.height);
      } else if (channel.kind === "cubemap") {
        const handle = this.resourceManager?.getCubemapTexture?.(channel.path);
        channelLoaded[channel.slot] = handle ? 1 : 0;
        this.setChannelResolution(channelResolution, channel.slot, handle?.width, handle?.height);
      } else if (channel.kind === "buffer") {
        const source = this.passPipelines.get(channel.source);
        const view = channel.readFrom === "previous-frame"
          ? source?.getPreviousOutputView()
          : source?.getCurrentOutputView();
        channelLoaded[channel.slot] = view ? 1 : 0;
        const sourcePass = this.passGraph.find((candidate) => candidate.name === channel.source);
        this.setChannelResolution(channelResolution, channel.slot, sourcePass?.width, sourcePass?.height);
      } else {
        channelLoaded[channel.slot] = this.resourceManager?.getKeyboardTexture?.() ? 1 : 0;
        this.setChannelResolution(channelResolution, channel.slot, 256, 3);
      }
    }

    return {
      channelTime,
      channelLoaded,
      sampleRate: this.resourceManager?.getAudioSampleRate?.() || 44100,
      channelResolution,
    };
  }

  private setChannelResolution(
    resolutions: number[],
    slot: number,
    width: number | undefined,
    height: number | undefined,
  ): void {
    if (width === undefined || height === undefined) {
      return;
    }
    resolutions[slot * 3] = width;
    resolutions[slot * 3 + 1] = height;
    resolutions[slot * 3 + 2] = 1;
  }

  // WebGL parity (PassRenderer.getTextureBindings): the keyboard texture is
  // refreshed at bind time, except paused frames skip input updates and keep
  // binding the stale texture from the last non-paused render.
  private resolveKeyboardHandle(skipInputUpdates: boolean): WebGPUTextureHandle | null {
    if (!this.resourceManager) {
      return null;
    }
    if (!skipInputUpdates) {
      this.resourceManager.updateKeyboardTexture(
        this.keyboardManager.getKeyHeld(),
        this.keyboardManager.getKeyPressed(),
        this.keyboardManager.getKeyToggled(),
      );
    }
    return this.resourceManager.getKeyboardTexture() ?? this.resourceManager.getDefaultTexture();
  }

  startRenderLoop(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) {
        return;
      }
      this.render(t);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stopRenderLoop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  handleCanvasResize(width: number, height: number): void {
    if (!this.canvas) {
      return;
    }
    const w = this.clampDimensionToTextureLimit(width);
    const h = this.clampDimensionToTextureLimit(height);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.applyPassResolutions();
    }
  }

  /**
   * Recompute each pass's resolution against the current canvas size — the
   * same way buildSlangPassGraph does at compile time — and resize the
   * matching pipelines so iResolution, the fragCoord Y-flip and buffer
   * texture sizes all stay correct without a recompile.
   */
  private applyPassResolutions(): void {
    if (!this.canvas || this.passGraph.length === 0) {
      return;
    }
    const canvasWidth = Math.max(1, this.canvas.width);
    const canvasHeight = Math.max(1, this.canvas.height);
    for (const pass of this.passGraph) {
      const unclampedResolution = pass.output === "canvas"
        ? { width: canvasWidth, height: canvasHeight }
        : resolvePassResolution({
          passName: pass.name,
          passConfig: this.currentConfig?.passes?.[pass.name],
          canvasWidth,
          canvasHeight,
          // Resolution settings were already validated at compile time; a
          // resize cannot introduce new config errors.
          errors: [],
        });
      const resolution = this.clampResolutionToTextureLimit(unclampedResolution);
      pass.width = resolution.width;
      pass.height = resolution.height;
      this.passPipelines.get(pass.name)?.resize(resolution.width, resolution.height);
    }
  }

  getResourceManager(): ResourceManager<WebGPUTextureHandle> | null {
    return this.resourceManager;
  }

  getCurrentConfig(): ShaderConfig | null {
    return this.currentConfig;
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  getTimeManager(): TimeManager {
    return this.timeManager;
  }

  togglePause(): void {
    const wasPaused = this.timeManager.isPaused();
    this.timeManager.togglePause();

    const shaderTime = this.timeManager.getCurrentTime(performance.now());
    this.resourceManager?.syncAllVideosToTime(shaderTime);
    this.resourceManager?.syncAllAudioToTime(shaderTime);

    if (wasPaused) {
      this.resourceManager?.resumeAllVideos();
      this.resourceManager?.resumeAllAudio();
    } else {
      this.resourceManager?.pauseAllVideos();
      this.resourceManager?.pauseAllAudio();
    }
  }

  resetTime(): void {
    this.timeManager.cleanup();
    this.cameraManager.reset();
  }

  setInputEnabled(enabled: boolean): void {
    this.mouseManager.setEnabled(enabled);
    this.keyboardManager.setEnabled(enabled);
    this.cameraManager.setEnabled(enabled);
  }

  getCurrentFPS(): number {
    return this.fps.getFPS();
  }

  getUniforms(): PassUniforms {
    const canvas = this.canvas;
    return {
      res: [canvas?.width ?? 0, canvas?.height ?? 0, 1],
      time: this.timeManager.getCurrentTime(performance.now()),
      timeDelta: this.timeManager.getDeltaTime(),
      frameRate: this.fps.getRawFPS(),
      mouse: Array.from(this.mouseManager.getMouse()),
      frame: this.timeManager.getFrame(),
      date: Array.from(this.timeManager.getCurrentDate()),
      channelTime: [0, 0, 0, 0],
      sampleRate: this.resourceManager?.getAudioSampleRate?.() || 44100,
      channelLoaded: [0, 0, 0, 0],
      cameraPos: Array.from(this.cameraManager.getCameraPos()),
      cameraDir: Array.from(this.cameraManager.getCameraDir()),
    };
  }

  cleanup(): void {
    this.stopRenderLoop();
    this.timeManager.cleanup();
    this.resourceManager?.cleanup();
  }

  dispose(): void {
    this.disposed = true;

    let firstError: unknown;
    let hasError = false;
    const attempt = (cleanup: () => void) => {
      try {
        cleanup();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    };

    const compilerAbortController = this.compilerAbortController;
    this.compilerAbortController = null;
    attempt(() => compilerAbortController?.abort());
    attempt(() => this.stopRenderLoop());
    attempt(() => this.mouseManager.dispose());
    attempt(() => this.keyboardManager.dispose());
    attempt(() => this.cameraManager.dispose());

    const compiler = this.compiler;
    this.compiler = null;
    attempt(() => compiler?.dispose());

    const inspectorReadbackBuffer = this.inspectorReadbackBuffer;
    this.inspectorReadbackBuffer = null;
    this.inspectorTarget = null;
    this.inspectorPixel = null;
    attempt(() => inspectorReadbackBuffer?.destroy?.());

    const passPipelines = [...this.passPipelines.values()];
    this.passPipelines.clear();
    this.passKeys.clear();
    this.passGraph = [];
    for (const pipeline of passPipelines) {
      attempt(() => pipeline.dispose());
    }

    const resourceManager = this.resourceManager;
    this.resourceManager = null;
    attempt(() => resourceManager?.cleanup());

    const candidateResourceManagers = [...this.candidateResourceManagers];
    this.candidateResourceManagers.clear();
    for (const candidateResourceManager of candidateResourceManagers) {
      if (candidateResourceManager !== resourceManager) {
        attempt(() => candidateResourceManager.cleanup());
      }
    }

    const device = this.device;
    this.device = null;
    attempt(() => device?.destroy?.());

    if (hasError) {
      throw firstError;
    }
  }

  /**
   * Patch a single buffer's source and re-run the last compile. The compile
   * path swaps pipelines atomically, so a failed recompile keeps the previous
   * working pipelines rendering.
   */
  async updateBufferAndRecompile(
    bufferName: string,
    bufferContent: string,
    workspace?: SlangWorkspaceSnapshot,
  ): Promise<CompilationResult | undefined> {
    if (!this.lastCompile) {
      return { success: false, errors: ["Cannot update a buffer before a shader has been compiled"] };
    }
    const buffers = { ...this.lastCompile.buffers, [bufferName]: bufferContent };
    return this.compileShaderPipeline(
      this.lastCompile.code,
      this.currentConfig,
      this.lastCompile.path,
      buffers,
      this.lastCompile.customUniformDeclarations,
      this.lastCompile.customUniformInfo,
      workspace ? cloneWorkspace(workspace) : this.lastCompile.workspace ? cloneWorkspace(this.lastCompile.workspace) : undefined,
    );
  }

  getPasses(): RenderPassNode[] {
    return this.passGraph;
  }

  // ---- Not yet supported in the Slang/WebGPU path ----

  flagReloadOnNextApply(): void {
    this.reloadOnNextApply = true;
  }

  getFrameTimeHistory(): number[] {
    if (this.frameTimeLen === 0) {
      return [];
    }
    const start = (
      this.frameTimeHead - this.frameTimeLen + WebGPURenderingEngine.MAX_FRAME_TIME_HISTORY
    ) % WebGPURenderingEngine.MAX_FRAME_TIME_HISTORY;
    if (start + this.frameTimeLen <= WebGPURenderingEngine.MAX_FRAME_TIME_HISTORY) {
      return this.frameTimeBuffer.slice(start, start + this.frameTimeLen);
    }
    return this.frameTimeBuffer.slice(start).concat(this.frameTimeBuffer.slice(0, this.frameTimeHead));
  }

  getFrameTimeCount(): number {
    return this.frameTimeCount;
  }

  setFPSLimit(limit: number): void {
    this.fpsLimit = limit;
    this.lastRenderedAt = null;
  }

  readPixel(x: number, y: number): { r: number; g: number; b: number; a: number } | null {
    if (!this.canvas || !this.device) {
      return null;
    }
    const clampedX = Math.min(Math.max(Math.floor(x), 0), this.canvas.width - 1);
    const clampedY = Math.min(Math.max(Math.floor(y), 0), this.canvas.height - 1);
    this.inspectorTarget = { x: clampedX, y: clampedY };
    return this.inspectorPixel;
  }

  /**
   * Encodes a 1×1 copy of the canvas texture at the inspector coordinate.
   * Must be called with the frame's encoder before submit; the buffer is
   * mapped after submit via resolveInspectorReadback().
   */
  private encodeInspectorCopy(encoder: GPUCommandEncoder, canvasTexture: GPUTexture | null): void {
    this.inspectorCopyEncoded = false;
    if (!this.inspectorTarget || this.inspectorReadbackPending || !canvasTexture || !this.device) {
      return;
    }

    if (!this.inspectorReadbackBuffer) {
      // GPUBufferUsage may be absent outside a browser; use the spec values.
      const MAP_READ = globalThis.GPUBufferUsage?.MAP_READ ?? 0x0001;
      const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
      // bytesPerRow must be 256-aligned even for a 1×1 copy.
      this.inspectorReadbackBuffer = this.device.createBuffer({
        size: 256,
        usage: MAP_READ | COPY_DST,
      });
    }

    encoder.copyTextureToBuffer(
      { texture: canvasTexture, origin: { x: this.inspectorTarget.x, y: this.inspectorTarget.y } },
      { buffer: this.inspectorReadbackBuffer, bytesPerRow: 256 },
      { width: 1, height: 1 },
    );
    this.inspectorCopyEncoded = true;
  }

  /** Maps the readback buffer after submit and caches the decoded pixel. */
  private resolveInspectorReadback(): void {
    const buffer = this.inspectorReadbackBuffer;
    if (!this.inspectorCopyEncoded || !buffer) {
      return;
    }
    this.inspectorCopyEncoded = false;
    this.inspectorReadbackPending = true;
    const MAP_READ_MODE = globalThis.GPUMapMode?.READ ?? 0x0001;
    buffer.mapAsync(MAP_READ_MODE)
      .then(() => {
        const bytes = new Uint8Array(buffer.getMappedRange(0, 4)).slice();
        buffer.unmap();
        this.inspectorReadbackPending = false;
        this.inspectorPixel = this.format === "bgra8unorm"
          ? { r: bytes[2], g: bytes[1], b: bytes[0], a: bytes[3] }
          : { r: bytes[0], g: bytes[1], b: bytes[2], a: bytes[3] };
      })
      .catch(() => {
        this.inspectorReadbackPending = false;
      });
  }

  createVariableCapturer(): IVariableCapturer {
    if (!this.device || !this.compiler) {
      throw new Error("Variable capture requires an initialized WebGPU engine");
    }
    return new WebGPUVariableCapturer(
      this.device,
      this.compiler,
      this.getVariableCaptureCompileContext(),
      (context) => {
        const pass = this.passGraph.find((candidate) => candidate.name === context.slangPassName)
          ?? this.passGraph.find((candidate) => candidate.name === "Image")
          ?? this.passGraph[0];
        return pass ? this.getChannelResources(pass) : [];
      },
    );
  }

  getVariableCaptureCompileContext(code?: string, passName?: string): CaptureCompileContext {
    const graph = this.getVariableCapturePassGraph();
    const targetPass = (passName
      ? graph.find((pass) => pass.name === passName)
      : undefined) ?? (code
      ? graph.find((pass) => pass.source === code)
      : undefined) ?? graph.find((pass) => pass.name === "Image") ?? graph[0];
    const commonCode = this.lastCompile?.buffers?.common ?? "";
    const workspace = this.lastCompile?.workspace ? cloneWorkspace(this.lastCompile.workspace) : undefined;
    const selector = targetPass?.name === "Image" ? this.lastCompile?.path : targetPass?.path;
    const roots = workspace && this.lastCompile
      ? workspaceCandidates(workspace, selector, this.lastCompile.path)
      : [];
    const root = roots.length === 1 ? roots[0] : undefined;
    this.capturePassName = targetPass?.name ?? null;
    return {
      commonCode,
      slangPassName: targetPass?.name,
      slangChannels: targetPass?.channels.map(({ slot, key, kind }) => ({ slot, key, kind })) ?? [],
      ...(root && workspace ? { sourceUri: root.uri, sourcePath: root.path, workspace } : {}),
      ...(workspace && !root ? { workspace, workspaceRootError: roots.length > 1 ? "Capture workspace has an ambiguous root source" : "Capture workspace has no matching root source" } : {}),
    };
  }

  private getVariableCapturePassGraph(): RenderPassNode[] {
    if (this.passGraph.length > 0 || !this.lastCompile) {
      return this.passGraph;
    }

    return buildSlangPassGraph({
      imageCode: this.lastCompile.code,
      config: this.currentConfig,
      buffers: this.lastCompile.buffers,
      canvasWidth: this.canvas?.width ?? 1,
      canvasHeight: this.canvas?.height ?? 1,
    }).passes;
  }

  getShaderLanguage(): "glsl" | "slang" {
    return "slang";
  }

  getCaptureUniforms(): CaptureUniforms {
    const u = this.getUniforms();
    const pass = this.passGraph.find((candidate) => candidate.name === this.capturePassName)
      ?? this.passGraph.find((candidate) => candidate.name === "Image")
      ?? this.passGraph[0];
    const channelUniforms = pass
      ? this.getChannelUniforms(pass)
      : {
        channelTime: [0, 0, 0, 0],
        channelLoaded: [0, 0, 0, 0],
        sampleRate: u.sampleRate,
        channelResolution: new Array<number>(12).fill(0),
      };
    return {
      time: u.time,
      timeDelta: u.timeDelta,
      frameRate: u.frameRate,
      frame: u.frame,
      res: pass ? [pass.width, pass.height, 1] : u.res as number[],
      mouse: u.mouse as number[],
      date: u.date as number[],
      cameraPos: u.cameraPos as number[],
      cameraDir: u.cameraDir as number[],
      ...channelUniforms,
    };
  }

  renderForCapture(): void {
    this.renderFrame(performance.now(), true);
  }

  // ---- Audio/video ----

  async resumeAudioContext(): Promise<void> {
    await this.resourceManager?.resumeAudioContext();
  }
  resumeAllAudio(): void {
    this.resourceManager?.resumeAllAudio();
  }
  resumeAllVideos(): void {
    this.resourceManager?.resumeAllVideos();
  }
  releaseMediaResetHold(): void {}
  updateAudioLoopRegion(path: string, startTime?: number, endTime?: number): void {
    this.resourceManager?.updateAudioLoopRegion(path, startTime, endTime);
  }
  setGlobalVolume(volume: number, muted: boolean): void {
    this.resourceManager?.setGlobalAudioState(volume, muted);
  }
  controlVideo(path: string, action: "play" | "pause" | "mute" | "unmute" | "reset"): void {
    this.resourceManager?.controlVideo(path, action);
  }
  getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    return this.resourceManager?.getVideoState(path) ?? null;
  }
  controlAudio(path: string, action: "play" | "pause" | "mute" | "unmute" | "reset"): void {
    this.resourceManager?.controlAudio(path, action);
  }
  getAudioState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    return this.resourceManager?.getAudioState(path) ?? null;
  }
  seekAudio(path: string, time: number): void {
    this.resourceManager?.seekAudio(path, time);
  }
  getAudioFFTData(type: string, path?: string): Uint8Array | null {
    return type === "audio" && path
      ? this.resourceManager?.getAudioFFTData(path) ?? null
      : null;
  }

  // ---- Custom uniforms ----

  getCustomUniformInfo(): { name: string; type: string }[] {
    return this.customUniformManager.getUniformInfo();
  }
  getCustomUniformDeclarations(): string {
    return this.customUniformManager.getDeclarations();
  }
  getCurrentCustomUniforms(): CaptureCustomUniform[] {
    return this.customUniformManager.getCurrentValues();
  }
  setCustomUniformValues(values: CustomUniform[]): void {
    this.pendingCustomUniformValues = values;
    this.customUniformManager.setValues(values);
  }
  updateCustomUniformValues(changed: CustomUniform[]): void {
    this.customUniformManager.updateValues(changed);
    this.pendingCustomUniformValues = this.customUniformManager.getCurrentValues();
  }
}
