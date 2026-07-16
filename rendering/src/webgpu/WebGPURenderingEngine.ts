/// <reference types="@webgpu/types" />
import type { ShaderConfig } from "@shader-studio/types";
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
import { FPSCalculator } from "../util/FPSCalculator";
import { SlangCompiler } from "./SlangCompiler";
import { loadSlangModule } from "./SlangModuleLoader";
import { MainThreadSlangCompiler, WorkerSlangCompiler, type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import { packShaderToyUniforms, type ShaderToyUniformInput } from "./uniforms";
import { ConfigValidator } from "../util/ConfigValidator";
import { buildSlangPassGraph, resolvePassResolution, type RenderPassNode } from "./SlangPassGraph";
import { SlangPassPipeline, type SlangChannelResource } from "./SlangPassPipeline";
import { sharedSlangWgslCache } from "./SlangWgslCache";
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
const SLANG_WGSL_CACHE_KEY_VERSION = 1;
const DEFAULT_MAX_TEXTURE_DIMENSION_2D = 8192;

class RevokingAsyncSlangCompiler implements AsyncSlangCompiler {
  constructor(
    private readonly inner: AsyncSlangCompiler,
    private readonly objectUrls: string[],
  ) {}

  compile(source: string, options: Parameters<AsyncSlangCompiler["compile"]>[1]): Promise<ReturnType<AsyncSlangCompiler["compile"]> extends Promise<infer T> ? T : never> {
    return this.inner.compile(source, options);
  }

  dispose(): void {
    this.inner.dispose();
    this.revokeObjectUrls();
  }

  private revokeObjectUrls(): void {
    for (const url of this.objectUrls) {
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
 * variable capture, texture inputs, video inputs, cubemap inputs, and keyboard
 * inputs are supported; audio remains unimplemented.
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
  private resourceManager: ResourceManager<WebGPUTextureHandle> | null = null;

  private passGraph: RenderPassNode[] = [];
  private passPipelines = new Map<string, SlangPassPipeline>();
  private passKeys = new Map<string, string>();
  private lastCompile: { code: string; path: string; buffers: Record<string, string> } | null = null;
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
  private forceCleanupOnNextApply = false;

  // Pixel inspector readback. WebGPU readback is async, so readPixel()
  // records the wanted coordinate and returns the last resolved pixel;
  // render() encodes a 1×1 copy of the canvas texture each frame while a
  // coordinate is requested and no mapping is in flight.
  private inspectorTarget: { x: number; y: number } | null = null;
  private inspectorPixel: { r: number; g: number; b: number; a: number } | null = null;
  private inspectorReadbackBuffer: GPUBuffer | null = null;
  private inspectorReadbackPending = false;
  private inspectorCopyEncoded = false;

  private timeManager = new TimeManager();
  private mouseManager = new MouseManager();
  private keyboardManager = new KeyboardManager();
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
  private static readonly MAX_FRAME_TIME_HISTORY = 3600;

  // WebGL pause parity (see FrameRenderer): while paused, per-frame uniform
  // inputs are frozen at the values captured when the pause began, so mouse
  // movement can't keep driving a "paused" shader.
  private pausedUniformInput: Omit<ShaderToyUniformInput, "width" | "height"> | null = null;

  constructor(private slangAssets: SlangAssetUrls) {}

  initialize(glCanvas: HTMLCanvasElement, _preserveDrawingBuffer = false): void {
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
      this.device = device;
      this.maxTextureDimension2D = this.resolveDeviceTextureLimit(device);
      this.clampCanvasToTextureLimit();
      this.resourceManager = new ResourceManager(new WebGPUTextureBackend(this.device));
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
      this.compiler = await this.createCompiler();
      this.logSlangPerf("init complete", {
        adapterMs: this.ms(adapterMs),
        deviceMs: this.ms(deviceMs),
        compilerMs: this.ms(this.now() - compilerStartedAt),
        totalMs: this.ms(this.now() - initStartedAt),
      });
    } catch (e) {
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
    const { scriptUrl, wasmUrl, workerUrl } = this.slangAssets;
    const startedAt = this.now();
    if (workerUrl && typeof Worker !== "undefined") {
      const objectUrls: string[] = [];
      try {
        this.logSlangPerf("worker fetch start", { workerUrl });
        const workerScript = await this.createBlobAssetUrl(workerUrl, "text/javascript", "text");
        objectUrls.push(workerScript.url);
        const slangScript = await this.createBlobAssetUrl(scriptUrl, "text/javascript", "text");
        objectUrls.push(slangScript.url);
        const slangWasm = await this.createBlobAssetUrl(wasmUrl, "application/wasm", "binary");
        objectUrls.push(slangWasm.url);
        this.logSlangPerf("worker fetch complete", {
          workerUrl,
          fetchMs: this.ms(workerScript.fetchMs + slangScript.fetchMs + slangWasm.fetchMs),
          blobMs: this.ms(workerScript.blobMs + slangScript.blobMs + slangWasm.blobMs),
        });
        const initStartedAt = this.now();
        this.logSlangPerf("worker init start", { workerUrl });
        const compiler = await WorkerSlangCompiler.create(
          () => new Worker(workerScript.url, { type: "module" }),
          slangScript.url,
          slangWasm.url,
          SLANG_WORKER_INIT_TIMEOUT_MS,
          (status) => this.logSlangPerf("worker status", { workerUrl, ...status }),
        );
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
        for (const url of objectUrls) {
          URL.revokeObjectURL(url);
        }
        console.warn("[Slang] worker compiler unavailable, compiling on main thread:", e);
      }
    }
    const mainThreadStartedAt = this.now();
    this.logSlangPerf("main-thread setup start", { workerUrl: workerUrl ?? null });
    const slang = await loadSlangModule(scriptUrl, wasmUrl);
    this.logSlangPerf("worker setup", {
      mode: "main-thread",
      workerUrl: workerUrl ?? null,
      loadSlangMs: this.ms(this.now() - mainThreadStartedAt),
      totalMs: this.ms(this.now() - startedAt),
    });
    return new MainThreadSlangCompiler(new SlangCompiler(slang));
  }

  private async createBlobAssetUrl(resourceUrl: string, mimeType: string, mode: "text" | "binary"): Promise<BlobAssetUrl> {
    const fetchStartedAt = this.now();
    const response = await fetch(resourceUrl);
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
  ): Promise<CompilationResult | undefined> {
    if (this.disposed) {
      return { success: false, errors: ["Engine disposed"], superseded: true };
    }
    // WebGL parity: the config is remembered even when invalid, but an
    // invalid one fails the compile before any Slang work starts.
    this.currentConfig = config;
    if (config) {
      const validation = ConfigValidator.validateConfig(config);
      if (!validation.isValid) {
        return {
          success: false,
          errors: [`Invalid shader configuration: ${validation.errors.join(", ")}`],
        };
      }
    }
    const startedAt = this.now();
    let readyMs = 0;
    // Captured synchronously (before any await) so concurrent calls made in
    // the same tick still get distinct, call-order-correct generations.
    const generation = ++this.compileGeneration;
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
    this.lastCompile = { code, path, buffers: { ...buffers } };
    if (this.ready) {
      const readyStartedAt = this.now();
      this.logSlangPerf("compile waiting for init", { path, generation });
      await this.ready;
      readyMs = this.now() - readyStartedAt;
      this.logSlangPerf("compile init ready", { path, generation, readyMs: this.ms(readyMs) });
    }

    if (this.initError || !this.device || !this.compiler) {
      const reason = this.initError ?? this.describeUnavailableInitState();
      this.logSlangPerf("compile unavailable", { path, generation, reason });
      return { success: false, errors: [`WebGPU init failed: ${reason}`] };
    }

    if (this.forceCleanupOnNextApply) {
      this.resourceManager?.cleanup();
      this.forceCleanupOnNextApply = false;
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
      return { success: false, errors: graph.errors, warnings: graph.warnings };
    }
    for (const pass of graph.passes) {
      const resolution = this.clampResolutionToTextureLimit(pass);
      pass.width = resolution.width;
      pass.height = resolution.height;
    }

    // WebGL parity (ShaderPipeline.updateResources): file-backed inputs are
    // loaded (and awaited) as part of the compile; render then only does cache
    // lookups.
    if (this.resourceManager) {
      for (const pass of graph.passes) {
        for (const channel of pass.channels) {
          if (channel.kind === "texture") {
            await this.resourceManager.loadImageTexture(channel.path, {
              filter: channel.filter,
              wrap: channel.wrap,
              vflip: channel.vflip,
              grayscale: channel.grayscale,
            });
          } else if (channel.kind === "video") {
            const result = await this.resourceManager.loadVideoTexture(channel.path, {
              filter: channel.filter,
              wrap: channel.wrap,
              vflip: channel.vflip,
            });
            if (result.warning) {
              graph.warnings.push(result.warning);
            }
          } else if (channel.kind === "cubemap") {
            await this.resourceManager.loadCubemapTexture(channel.path, {
              filter: channel.filter,
              wrap: channel.wrap,
              vflip: channel.vflip,
            });
          }
        }
      }
    }

    const nextPipelines = new Map<string, SlangPassPipeline>();
    const nextKeys = new Map<string, string>();
    const passTimings: PassTiming[] = [];
    const errors: string[] = [];
    for (const pass of graph.passes) {
      const passStartedAt = this.now();
      const key = WebGPURenderingEngine.passCacheKey(pass, graph.commonCode);
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
        let wgsl = sharedSlangWgslCache.get(key);
        const wgslCacheHit = wgsl !== null;
        let slangMs = 0;
        if (!wgsl) {
          const slangStartedAt = this.now();
          const compiled = await this.compiler.compile(pass.source, {
            passName: pass.name,
            commonCode: graph.commonCode,
            channels: pass.channels.map((channel) => ({
              slot: channel.slot,
              key: channel.key,
              kind: channel.kind,
            })),
          });
          slangMs = this.now() - slangStartedAt;
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
          sharedSlangWgslCache.set(key, wgsl);
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
      return { success: false, errors, warnings: graph.warnings };
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
      return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
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
    this.passGraph = graph.passes;
    this.passPipelines = nextPipelines;
    this.passKeys = nextKeys;
    // Correct any canvas resize that landed mid-compile immediately, rather
    // than leaving passes stale until the next resize/recompile.
    this.applyPassResolutions();
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
    return { success: true, warnings: graph.warnings.length > 0 ? graph.warnings : undefined };
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

  /**
   * A pass's compiled WGSL depends on its compile options: pass name, source,
   * common code, cache key version, and channel layout (slot + key + kind).
   * Width/height are texture concerns handled by resize() without recompiling,
   * so they're deliberately excluded from the key.
   */
  private static passCacheKey(pass: RenderPassNode, commonCode: string): string {
    const channels = pass.channels.map((channel) => `${channel.slot}:${channel.key}:${channel.kind}`).join(",");
    return JSON.stringify([SLANG_WGSL_CACHE_KEY_VERSION, pass.name, pass.source, commonCode, channels]);
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
      });
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
    this.timeManager.togglePause();
  }

  resetTime(): void {
    this.timeManager.cleanup();
  }

  setInputEnabled(enabled: boolean): void {
    this.mouseManager.setEnabled(enabled);
    this.keyboardManager.setEnabled(enabled);
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
      sampleRate: 44100,
      channelLoaded: [0, 0, 0, 0],
      cameraPos: [0, 0, 0],
      cameraDir: [0, 0, -1],
    };
  }

  cleanup(): void {
    this.stopRenderLoop();
    this.timeManager.cleanup();
    this.resourceManager?.cleanup();
  }

  dispose(): void {
    this.disposed = true;
    this.stopRenderLoop();
    this.compiler?.dispose();
    this.compiler = null;
    this.inspectorReadbackBuffer?.destroy?.();
    this.inspectorReadbackBuffer = null;
    this.inspectorTarget = null;
    this.inspectorPixel = null;
    for (const pipeline of this.passPipelines.values()) {
      pipeline.dispose();
    }
    this.passPipelines.clear();
    this.passKeys.clear();
    this.passGraph = [];
    this.resourceManager?.cleanup();
    this.device?.destroy?.();
    this.device = null;
  }

  /**
   * Patch a single buffer's source and re-run the last compile. The compile
   * path swaps pipelines atomically, so a failed recompile keeps the previous
   * working pipelines rendering.
   */
  async updateBufferAndRecompile(
    bufferName: string,
    bufferContent: string,
  ): Promise<CompilationResult | undefined> {
    if (!this.lastCompile) {
      return { success: false, errors: ["Cannot update a buffer before a shader has been compiled"] };
    }
    this.lastCompile.buffers = { ...this.lastCompile.buffers, [bufferName]: bufferContent };
    return this.compileShaderPipeline(
      this.lastCompile.code,
      this.currentConfig,
      this.lastCompile.path,
      this.lastCompile.buffers,
    );
  }

  getPasses(): RenderPassNode[] {
    return this.passGraph;
  }

  // ---- Not yet supported in the Slang/WebGPU path ----

  flagForceCleanupOnNextApply(): void {
    this.forceCleanupOnNextApply = true;
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
      () => {
        const pass = this.passGraph.find((p) => p.name === "Image") ?? this.passGraph[0];
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
    return {
      commonCode,
      slangChannels: targetPass?.channels.map(({ slot, key }) => ({ slot, key })) ?? [],
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
    return {
      time: u.time,
      timeDelta: u.timeDelta,
      frameRate: u.frameRate,
      frame: u.frame,
      res: u.res as number[],
      mouse: u.mouse as number[],
      date: u.date as number[],
      cameraPos: u.cameraPos as number[],
      cameraDir: u.cameraDir as number[],
    };
  }

  renderForCapture(): void {
    this.renderFrame(performance.now(), true);
  }

  // ---- Audio/video (Slang/WebGPU only supports video texture resources today) ----

  async resumeAudioContext(): Promise<void> {}
  resumeAllAudio(): void {}
  resumeAllVideos(): void {
    this.resourceManager?.resumeAllVideos();
  }
  releaseMediaResetHold(): void {}
  hasUserPausedAudio(): boolean {
    return false;
  }
  updateAudioLoopRegion(): void {}
  setGlobalVolume(): void {}
  controlVideo(path: string, action: "play" | "pause" | "mute" | "unmute" | "reset"): void {
    this.resourceManager?.controlVideo(path, action);
  }
  getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    return this.resourceManager?.getVideoState(path) ?? null;
  }
  controlAudio(): void {}
  getAudioState(): null {
    return null;
  }
  seekAudio(): void {}
  getAudioFFTData(): Uint8Array | null {
    return null;
  }

  // ---- Custom uniforms (M2) ----

  getCustomUniformInfo(): { name: string; type: string }[] {
    return [];
  }
  getCustomUniformDeclarations(): string {
    return "";
  }
  getCurrentCustomUniforms(): CaptureCustomUniform[] {
    return [];
  }
  setCustomUniformValues(): void {}
  updateCustomUniformValues(): void {}
}
