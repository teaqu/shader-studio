/// <reference types="@webgpu/types" />
import type { DebugInstrumentationPlan, ShaderConfig, SlangSourceModule, StorageBufferSnapshot } from "@shader-studio/types";
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
import { SlangCompiler } from "./SlangCompiler";
import { loadSlangModule } from "./SlangModuleLoader";
import { MainThreadSlangCompiler, WorkerSlangCompiler, type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import {
  createSlangCustomUniformLayout,
  packShaderToyUniforms,
  type ShaderToyUniformInput,
} from "./uniforms";
import { CustomUniformManager, type CustomUniform } from "../webgl/CustomUniformManager";
import { ConfigValidator } from "../util/ConfigValidator";
import {
  buildSlangPassGraph,
  resolvePassResolution,
  type ComputeWorkgroupLimits,
  type RenderPassNode,
} from "./SlangPassGraph";
import type { StorageBindingNode } from "../types/PassGraph";
import { SlangComputePipeline } from "./SlangComputePipeline";
import {
  BUFFER_TEXTURE_FORMAT,
  HIGH_PRECISION_BUFFER_TEXTURE_FORMAT,
  SlangPassPipeline,
  type SlangChannelResource,
} from "./SlangPassPipeline";
import { sharedSlangWgslCache } from "./SlangWgslCache";
import { WebGPUTextureBackend, type WebGPUTextureHandle } from "./WebGPUTextureBackend";
import { ResourceManager } from "../resources/ResourceManager";
import type { PixelRegionResult } from "../types/PixelRegion";
import { WebGPUPixelRegionCapturer } from "./WebGPUPixelRegionCapturer";
import { WebGPUMeshResources } from "./WebGPUMeshResources";
import { OrbitCamera } from "../preview3d/OrbitCamera";
import { createModelMatrix, createNormalMatrix3, multiplyMatrices } from "../preview3d/math";
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

interface PreparedStorageBuffers {
  generation: number;
  buffers: Map<string, GPUBuffer>;
  keys: Map<string, string>;
  layouts: Map<string, StorageBindingNode>;
  stagedBuffers: GPUBuffer[];
  settled: boolean;
}

interface PendingPipelineCandidates {
  generation: number;
  render: Set<SlangPassPipeline>;
  compute: Set<SlangComputePipeline>;
  resourceManager: ResourceManager<WebGPUTextureHandle> | null;
  resourceLoadsPending: number;
  resourceManagerDisposed: boolean;
  installed: boolean;
  settled: boolean;
}

interface ShaderCompileSnapshot {
  code: string;
  config: ShaderConfig | null;
  path: string;
  buffers: Record<string, string>;
  customUniformDeclarations?: string;
  customUniformInfo?: { name: string; type: string }[];
  slangModules: SlangSourceModule[];
  slangSourcePath?: string;
  slangSourcePaths?: Record<string, string>;
}

const SLANG_WORKER_INIT_TIMEOUT_MS = 1500;
const SLANG_WGSL_CACHE_KEY_VERSION = 3;
const SLANG_PIPELINE_CACHE_KEY_VERSION = 1;
const DEFAULT_MAX_TEXTURE_DIMENSION_2D = 8192;
const DEFAULT_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE = 8;
const DEFAULT_MAX_STORAGE_BUFFER_BINDING_SIZE = 128 * 1024 * 1024;
const DEFAULT_MAX_COMPUTE_WORKGROUPS_PER_DIMENSION = 65_535;
const DEFAULT_MAX_COMPUTE_INVOCATIONS_PER_WORKGROUP = 256;
const DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_X = 256;
const DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Y = 256;
const DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Z = 64;

type WorkgroupCounts = [number, number, number];

function resolveWorkgroupCounts(
  pass: RenderPassNode,
  storageLayouts: Map<string, StorageBindingNode>,
  channelResources: SlangChannelResource[],
): WorkgroupCounts | null {
  const dispatch = pass.dispatch ?? { mode: "texel" };
  switch (dispatch.mode) {
    case "texel":
      return [
        Math.ceil(pass.width / pass.workgroupSize[0]),
        Math.ceil(pass.height / pass.workgroupSize[1]),
        1,
      ];
    case "count":
      return [Math.ceil(dispatch.count / pass.workgroupSize[0]), 1, 1];
    case "workgroups":
      return [dispatch.x, dispatch.y, dispatch.z];
    case "cover-storage": {
      const storage = storageLayouts.get(dispatch.name);
      return storage
        ? [Math.ceil(storage.count / pass.workgroupSize[0]), 1, 1]
        : null;
    }
    case "cover-channel": {
      const channel = pass.channels.find(({ key }) => key === dispatch.key);
      const resource = channelResources.find(({ slot }) => slot === channel?.slot);
      const width = resource?.width;
      const height = resource?.height;
      if (
        typeof width !== "number" ||
        typeof height !== "number" ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return null;
      }
      return [
        Math.ceil(width / pass.workgroupSize[0]),
        Math.ceil(height / pass.workgroupSize[1]),
        1,
      ];
    }
  }
}

function validateWorkgroupCounts(
  passName: string,
  counts: WorkgroupCounts,
  limit: number,
): string | null {
  const axes = ["x", "y", "z"] as const;
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] > limit) {
      return `${passName}: dispatch ${axes[index]} count ${counts[index]} exceeds device limit ${limit}`;
    }
  }
  return null;
}

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

/**
 * WebGPU/Slang counterpart to the WebGL RenderingEngine. Supports multi-pass
 * rendering driven by the ShaderToy-style Slang convention (iTime,
 * iResolution, iMouse, iFrame): configured buffer passes render to float
 * ping-pong textures that other passes sample via iChannelN, and the Image pass
 * renders to the canvas. Inline Slang debugging, pixel inspection (async readback),
 * variable capture, texture inputs, video inputs, cubemap inputs, audio inputs,
 * and keyboard inputs are supported.
 */
export class WebGPURenderingEngine implements RenderingEngine {
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private bufferTextureFormat: GPUTextureFormat = BUFFER_TEXTURE_FORMAT;
  private ready: Promise<void> | null = null;
  private initError: string | null = null;
  private maxTextureDimension2D = DEFAULT_MAX_TEXTURE_DIMENSION_2D;

  private compiler: AsyncSlangCompiler | null = null;
  private compilerAbortController: AbortController | null = null;
  private resourceManager: ResourceManager<WebGPUTextureHandle> | null = null;
  private meshResources: WebGPUMeshResources | null = null;
  private meshCamera = new OrbitCamera();

  private passGraph: RenderPassNode[] = [];
  private passPipelines = new Map<string, SlangPassPipeline>();
  private passKeys = new Map<string, string>();
  private computePipelines = new Map<string, SlangComputePipeline>();
  private computeKeys = new Map<string, string>();
  private storageBuffers = new Map<string, GPUBuffer>();
  private storageKeys = new Map<string, string>();
  private storageLayouts = new Map<string, StorageBindingNode>();
  private dispatchOnceRan = new Set<string>();
  private hasSubmittedFrameForInstalledGeneration = false;
  private pendingStoragePreparations = new Set<PreparedStorageBuffers>();
  private pendingPipelineCandidates = new Set<PendingPipelineCandidates>();
  private resetStorageOnNextSync = false;
  private shaderPath = "";
  private installedResourceKey: string | null = null;
  private lastCompile: ShaderCompileSnapshot | null = null;
  private installedCompile: ShaderCompileSnapshot | null = null;
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
  private globalVolume = 1;
  private globalMuted = false;
  private resetFeedbackOnNextApply = false;

  private pixelRegionCapturer: WebGPUPixelRegionCapturer | null = null;
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
    this.meshCamera.attach(glCanvas);
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
      this.meshResources = new WebGPUMeshResources(device);
      this.bufferTextureFormat = adapter.features?.has?.("float32-filterable")
        ? HIGH_PRECISION_BUFFER_TEXTURE_FORMAT
        : BUFFER_TEXTURE_FORMAT;
      this.maxTextureDimension2D = this.resolveDeviceTextureLimit(device);
      this.clampCanvasToTextureLimit();
      this.resourceManager = new ResourceManager(new WebGPUTextureBackend(this.device));
      this.resourceManager.setGlobalAudioState(this.globalVolume, this.globalMuted);
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
      this.pixelRegionCapturer?.dispose();
      this.pixelRegionCapturer = new WebGPUPixelRegionCapturer(device, this.format);

      const compilerStartedAt = this.now();
      this.logSlangPerf("compiler create start", {});
      const compiler = await this.createCompiler();
      if (this.disposed) {
        compiler.dispose();
        return;
      }
      this.compiler = compiler;
      this.logSlangPerf("init complete", {
        bufferTextureFormat: this.bufferTextureFormat,
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
    const requiredLimits: Record<string, number> = {};
    const adapterTextureLimit = adapter.limits?.maxTextureDimension2D;
    if (
      typeof adapterTextureLimit === "number" &&
      Number.isFinite(adapterTextureLimit) &&
      adapterTextureLimit > DEFAULT_MAX_TEXTURE_DIMENSION_2D
    ) {
      requiredLimits.maxTextureDimension2D = adapterTextureLimit;
    }
    const adapterStorageCountLimit = adapter.limits?.maxStorageBuffersPerShaderStage;
    if (
      typeof adapterStorageCountLimit === "number" &&
      Number.isFinite(adapterStorageCountLimit) &&
      adapterStorageCountLimit > DEFAULT_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE
    ) {
      requiredLimits.maxStorageBuffersPerShaderStage = adapterStorageCountLimit;
    }
    const adapterStorageSizeLimit = adapter.limits?.maxStorageBufferBindingSize;
    if (
      typeof adapterStorageSizeLimit === "number" &&
      Number.isFinite(adapterStorageSizeLimit) &&
      adapterStorageSizeLimit > DEFAULT_MAX_STORAGE_BUFFER_BINDING_SIZE
    ) {
      requiredLimits.maxStorageBufferBindingSize = adapterStorageSizeLimit;
    }
    const computeLimits: Array<[keyof GPUSupportedLimits, number]> = [
      ["maxComputeInvocationsPerWorkgroup", DEFAULT_MAX_COMPUTE_INVOCATIONS_PER_WORKGROUP],
      ["maxComputeWorkgroupSizeX", DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_X],
      ["maxComputeWorkgroupSizeY", DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Y],
      ["maxComputeWorkgroupSizeZ", DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Z],
    ];
    for (const [name, portableLimit] of computeLimits) {
      const adapterLimit = adapter.limits?.[name];
      if (
        typeof adapterLimit === "number" &&
        Number.isFinite(adapterLimit) &&
        adapterLimit > portableLimit
      ) {
        requiredLimits[name] = adapterLimit;
      }
    }
    const supportsFloat32Filtering = adapter.features?.has?.("float32-filterable") ?? false;
    if (!supportsFloat32Filtering && Object.keys(requiredLimits).length === 0) {
      return undefined;
    }

    const descriptor: GPUDeviceDescriptor = {};
    if (supportsFloat32Filtering) {
      descriptor.requiredFeatures = ["float32-filterable"];
    }
    if (Object.keys(requiredLimits).length > 0) {
      descriptor.requiredLimits = requiredLimits;
    }
    return descriptor;
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
    slangModules: SlangSourceModule[] = [],
    slangSourcePath?: string,
    slangSourcePaths?: Record<string, string>,
  ): Promise<CompilationResult | undefined> {
    if (this.disposed) {
      return { success: false, errors: ["Engine disposed"], superseded: true };
    }
    // Captured synchronously (before any await) so concurrent calls made in
    // the same tick still get distinct, call-order-correct generations.
    const generation = ++this.compileGeneration;
    for (const prepared of [...this.pendingStoragePreparations]) {
      if (prepared.generation < generation) {
        this.discardPreparedStorage(prepared);
      }
    }
    for (const candidates of [...this.pendingPipelineCandidates]) {
      if (candidates.generation < generation) {
        this.discardPipelineCandidates(candidates);
      }
    }
    const sessionChanged = this.shaderPath !== "" && this.shaderPath !== path;
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
    let attemptedCompile: ShaderCompileSnapshot;
    let prospectiveInstalledCompile: ShaderCompileSnapshot;
    try {
      // Read caller-owned/proxy-backed input exactly once, before any live
      // ownership transfer. The second snapshot clones only this plain object.
      const bufferSnapshot = { ...buffers };
      const snapshotMetadata = {
        customUniformDeclarations,
        customUniformInfo: customUniformInfo?.map((uniform) => ({ ...uniform })),
        slangModules: slangModules.map((module) => ({ ...module })),
        slangSourcePath,
        slangSourcePaths: slangSourcePaths ? { ...slangSourcePaths } : undefined,
      };
      attemptedCompile = { code, config, path, buffers: bufferSnapshot, ...snapshotMetadata };
      prospectiveInstalledCompile = {
        code,
        config,
        path,
        buffers: { ...bufferSnapshot },
        ...snapshotMetadata,
      };
    } catch (error) {
      return this.failedCompilation(path, generation, {
        success: false,
        errors: [`Failed to snapshot shader buffers: ${
          error instanceof Error ? error.message : String(error)
        }`],
      });
    }
    // Remember the inputs so updateBufferAndRecompile can re-run this compile
    // with a single buffer's content patched.
    this.lastCompile = attemptedCompile;
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
      buffers: attemptedCompile.buffers,
      canvasWidth: this.canvas?.width ?? 1,
      canvasHeight: this.canvas?.height ?? 1,
      computeWorkgroupLimits: this.resolveComputeWorkgroupLimits(),
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
      console.info("[Shader Studio][Slang 3D] graph", graph.passes.map((pass) => ({
        name: pass.name,
        geometry: pass.geometry,
        kind: pass.kind,
      })));
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
    const storageErrors = this.validateStorageLimits(graph.storage);
    if (storageErrors.length > 0) {
      return this.failedCompilation(path, generation, {
        success: false,
        errors: storageErrors,
        warnings: graph.warnings,
      });
    }
    const dispatchErrors = this.validateStaticComputeDispatchLimits(graph.passes, graph.storage);
    if (dispatchErrors.length > 0) {
      return this.failedCompilation(path, generation, {
        success: false,
        errors: dispatchErrors,
        warnings: graph.warnings,
      });
    }
    if (generation !== this.compileGeneration || this.disposed) {
      return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
    }
    let preparedStorage: PreparedStorageBuffers | undefined;
    let candidateResourceManager: ResourceManager<WebGPUTextureHandle> | null = null;
    let pipelineCandidates: PendingPipelineCandidates | undefined;
    const passTimings: PassTiming[] = [];
    const errors: string[] = [];
    let published = false;
    try {
      try {
        preparedStorage = this.prepareStorageBuffers(graph.storage, generation, sessionChanged);
      } catch (error) {
        return this.failedCompilation(path, generation, {
          success: false,
          errors: [`Storage allocation failed: ${error instanceof Error ? error.message : String(error)}`],
          warnings: graph.warnings,
        });
      }
      const resourceKey = WebGPURenderingEngine.resourceLayoutKey(graph.passes);
      const hasFileResources = WebGPURenderingEngine.hasFileResources(graph.passes);
      const requiresResourceCandidate = Boolean(this.resourceManager) && (
        sessionChanged ||
        this.reloadOnNextApply ||
        hasFileResources && resourceKey !== this.installedResourceKey ||
        this.installedResourceKey !== null && resourceKey !== this.installedResourceKey
      );
      candidateResourceManager = requiresResourceCandidate
        ? this.resourceManager?.createIsolated?.() ?? (
          sessionChanged ? new ResourceManager(new WebGPUTextureBackend(this.device)) : null
        )
        : null;
      candidateResourceManager?.setGlobalAudioState(this.globalVolume, this.globalMuted);
      const compileResourceManager = candidateResourceManager ?? this.resourceManager;
      pipelineCandidates = this.preparePipelineCandidates(generation, candidateResourceManager);

      // WebGL parity (ShaderPipeline.updateResources): file-backed inputs are
      // loaded (and awaited) as part of the compile; render then only does cache
      // lookups.
      if (compileResourceManager) {
        for (const pass of graph.passes) {
          for (const channel of pass.channels) {
            if (channel.kind === "texture") {
              await this.trackCandidateResourceLoad(pipelineCandidates, () =>
                compileResourceManager.loadImageTexture(channel.path, {
                  filter: channel.filter,
                  wrap: channel.wrap,
                  vflip: channel.vflip,
                  grayscale: channel.grayscale,
                }), compileResourceManager);
            } else if (channel.kind === "video") {
              const result = await this.trackCandidateResourceLoad(pipelineCandidates, () =>
                compileResourceManager.loadVideoTexture(channel.path, {
                  filter: channel.filter,
                  wrap: channel.wrap,
                  vflip: channel.vflip,
                  muted: channel.muted,
                }), compileResourceManager);
              if (result.warning) {
                graph.warnings.push(result.warning);
              }
            } else if (channel.kind === "cubemap") {
              await this.trackCandidateResourceLoad(pipelineCandidates, () =>
                compileResourceManager.loadCubemapTexture(channel.path, {
                  filter: channel.filter,
                  wrap: channel.wrap,
                  vflip: channel.vflip,
                }), compileResourceManager);
            } else if (channel.kind === "audio") {
              try {
                await this.trackCandidateResourceLoad(pipelineCandidates, () =>
                  compileResourceManager.loadAudioSource(channel.path, {
                    muted: channel.muted,
                    startTime: channel.startTime,
                    endTime: channel.endTime,
                  }), compileResourceManager);
                compileResourceManager.updateAudioLoopRegion(
                  channel.path,
                  channel.startTime,
                  channel.endTime,
                );
              } catch {
                graph.warnings.push(`Audio loading failed: ${channel.path}`);
              }
            }
            if (generation !== this.compileGeneration || this.disposed) {
              return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
            }
          }
        }
      }

      if (generation !== this.compileGeneration || this.disposed) {
        return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
      }

      for (const pass of graph.passes) {
        if (pass.modelPath) {
          try {
            await this.meshResources?.loadModel(pass.name, pass.modelPath, pass.modelMesh);
          } catch (error) {
            errors.push(WebGPURenderingEngine.prefixPassError(pass.name, error instanceof Error ? error.message : String(error)));
          }
        }
      }
      if (errors.length > 0) {
        return this.failedCompilation(path, generation, { success: false, errors, warnings: graph.warnings });
      }

      const nextPipelines = new Map<string, SlangPassPipeline>();
      const nextKeys = new Map<string, string>();
      const nextComputePipelines = new Map<string, SlangComputePipeline>();
      const nextComputeKeys = new Map<string, string>();
      for (const pass of graph.passes) {
        if (generation !== this.compileGeneration || this.disposed) {
          break;
        }
        const passStartedAt = this.now();
        const passModules = slangModules
          .filter((module) => module.ownerPass === pass.name)
          .map(({ ownerPass: _ownerPass, ...module }) => module);
        const uniformInfo = nextCustomUniformManager.getUniformInfo();
        const wgslKey = WebGPURenderingEngine.wgslCacheKey(
          pass,
          graph.commonCode,
          graph.storage,
          uniformInfo,
          passModules,
        );
        const pipelineKey = WebGPURenderingEngine.pipelineCacheKey(
          pass,
          graph.commonCode,
          graph.storage,
          uniformInfo,
          passModules,
        );
        const isCompute = pass.kind === "compute";
        const existing = sessionChanged
          ? undefined
          : isCompute
            ? this.computePipelines.get(pass.name)
            : this.passPipelines.get(pass.name);
        const existingKey = sessionChanged
          ? undefined
          : isCompute
            ? this.computeKeys.get(pass.name)
            : this.passKeys.get(pass.name);
        if (existing && existingKey === pipelineKey) {
          // Unchanged pass: carry the live pipeline into the next generation.
          // Resize (if the canvas changed) is deferred to the success block so
          // this loop stays mutation-free while a later pass can still fail.
          if (isCompute) {
            nextComputePipelines.set(pass.name, existing as SlangComputePipeline);
            nextComputeKeys.set(pass.name, pipelineKey);
          } else {
            nextPipelines.set(pass.name, existing as SlangPassPipeline);
            nextKeys.set(pass.name, pipelineKey);
          }
          passTimings.push({
            name: pass.name,
            cacheHit: true,
            totalMs: this.ms(this.now() - passStartedAt),
          });
          continue;
        }
        let pipeline: SlangPassPipeline | SlangComputePipeline | undefined;
        try {
          let wgsl = sharedSlangWgslCache.get(wgslKey);
          const wgslCacheHit = wgsl !== null;
          let slangMs = 0;
          const channels = [...pass.channels]
            .sort((a, b) => a.slot - b.slot)
            .map((channel) => ({
              slot: channel.slot,
              key: channel.key,
              kind: channel.kind,
            }));
          if (!wgsl) {
            console.info("[Shader Studio][Slang 3D] compiling pass", {
              name: pass.name,
              geometry: pass.geometry,
              vertexHook: Boolean(pass.vertexSrc),
            });
            const slangStartedAt = this.now();
            const compiled = await this.compiler.compile(pass.source, {
              passName: pass.name,
              commonCode: graph.commonCode,
              channels,
              storage: graph.storage,
              passKind: pass.kind,
              ...(pass.geometry !== "fullscreen" ? { geometry: pass.geometry } : {}),
              ...(pass.vertexSrc ? { vertexCode: pass.vertexSrc } : {}),
              workgroupSize: pass.workgroupSize,
              outputLayers: pass.outputLayers,
              hasOutput: pass.output === "texture",
              ...(pass.kind === "compute" ? { entryPoint: pass.entryPoint } : {}),
              ...(passModules.length > 0 ? { modules: passModules } : {}),
              ...(slangSourcePaths?.[pass.name]
                ? { sourcePath: slangSourcePaths[pass.name] }
                : slangSourcePath ? { sourcePath: slangSourcePath } : {}),
              ...(nextCustomUniformManager.hasUniforms()
                ? { customUniforms: uniformInfo }
                : {}),
            });
            slangMs = this.now() - slangStartedAt;
            if (generation !== this.compileGeneration || this.disposed) {
              break;
            }
            if (!compiled.success) {
              errors.push(...compiled.errors.map((error) =>
                WebGPURenderingEngine.prefixPassError(pass.name, error)));
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
            sharedSlangWgslCache.set(wgslKey, wgsl);
          }
          pipeline = this.createPassPipeline(
            pass,
            graph.storage,
            createSlangCustomUniformLayout(uniformInfo).size,
          );
          if (!this.registerPipelineCandidate(pipelineCandidates, pipeline)) {
            break;
          }
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
          if (isCompute) {
            nextComputePipelines.set(pass.name, pipeline as SlangComputePipeline);
            nextComputeKeys.set(pass.name, pipelineKey);
          } else {
            nextPipelines.set(pass.name, pipeline as SlangPassPipeline);
            nextKeys.set(pass.name, pipelineKey);
          }
        } catch (error) {
          errors.push(WebGPURenderingEngine.prefixPassError(
            pass.name,
            error instanceof Error ? error.message : String(error),
          ));
          passTimings.push({
            name: pass.name,
            cacheHit: false,
            totalMs: this.ms(this.now() - passStartedAt),
            errorCount: 1,
          });
        }

      }

      if (errors.length > 0) {
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
        return this.failedCompilation(path, generation, {
          success: false,
          errors,
          warnings: graph.warnings,
        });
      }

      if (generation !== this.compileGeneration || this.disposed) {
        // A newer compileShaderPipeline call (or dispose()) already landed
        // while this attempt was awaiting the compiler/worker. Installing now
        // would clobber the newer, already-live pipelines with stale ones, so
        // drop this attempt; its transaction owns only pipelines allocated by
        // this generation, never reused installed predecessors.
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

      const resolutionErrors = await this.reconcileCandidateResolutions(
        graph,
        config,
        nextPipelines,
        nextKeys,
        nextComputePipelines,
        nextComputeKeys,
        pipelineCandidates,
        generation,
        nextCustomUniformManager.getUniformInfo(),
        slangModules,
      );
      if (generation !== this.compileGeneration || this.disposed) {
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
      if (resolutionErrors.length > 0) {
        errors.push(...resolutionErrors);
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
        return this.failedCompilation(path, generation, {
          success: false,
          errors,
          warnings: graph.warnings,
        });
      }

      // setGlobalVolume() and pause state may change while resource loading or
      // Slang compilation awaits. Apply their latest values to the prospective
      // manager before publication; any media failure is still transactional.
      if (candidateResourceManager) {
        try {
          candidateResourceManager?.setGlobalAudioState(this.globalVolume, this.globalMuted);
          // A path switch resets shader time immediately after publication.
          // Stage the media against that prospective time, not the retiring
          // session's clock.
          const shaderTime = sessionChanged && (
            this.passPipelines.size > 0 || this.computePipelines.size > 0
          )
            ? 0
            : this.timeManager.getCurrentTime(performance.now());
          candidateResourceManager.syncAllVideosToTime?.(shaderTime);
          if (this.timeManager.isPaused()) {
            candidateResourceManager.pauseAllVideos?.();
          } else {
            candidateResourceManager.resumeAllVideos?.();
          }
        } catch (error) {
          errors.push(`Media synchronization failed: ${
            error instanceof Error ? error.message : String(error)
          }`);
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
          return this.failedCompilation(path, generation, {
            success: false,
            errors,
            warnings: graph.warnings,
          });
        }
      }

      // Enumerating the retiring map can invoke user-modified iterators and
      // allocate. Finish that work while the installed generation is still
      // untouched; publication below then contains ownership assignments only.
      const retiredStorageBuffers = this.collectRetiredStorageBuffers(preparedStorage);

      // All resolution-sensitive work above was staged in candidate-owned
      // pipelines. Publication below is therefore a synchronous map swap: a
      // failure can never leave a subset of the installed graph resized.
      const previousPipelines = this.passPipelines;
      const previousComputePipelines = this.computePipelines;
      const previousResourceManager = this.resourceManager;
      const hadInstalledPipeline = previousPipelines.size > 0 || previousComputePipelines.size > 0;
      this.passGraph = graph.passes;
      this.passPipelines = nextPipelines;
      this.passKeys = nextKeys;
      this.computePipelines = nextComputePipelines;
      this.computeKeys = nextComputeKeys;
      this.dispatchOnceRan.clear();
      this.hasSubmittedFrameForInstalledGeneration = false;
      if (candidateResourceManager) {
        this.resourceManager = candidateResourceManager;
      }
      this.publishPreparedStorage(preparedStorage);
      this.installPipelineCandidates(pipelineCandidates);
      this.shaderPath = path;
      this.installedResourceKey = resourceKey;
      this.reloadOnNextApply = false;
      this.currentConfig = config;
      this.installedCompile = prospectiveInstalledCompile;
      if (this.pendingCustomUniformValues) {
        nextCustomUniformManager.updateValues(this.pendingCustomUniformValues);
      }
      this.customUniformManager = nextCustomUniformManager;
      if (this.resetFeedbackOnNextApply) {
        for (const pass of this.passGraph) {
          if (pass.output !== "texture") {
            continue;
          }
          if (pass.kind === "compute") {
            this.computePipelines.get(pass.name)?.resetOutputTextures();
          } else {
            this.passPipelines.get(pass.name)?.resetOutputTextures();
          }
        }
        this.resetFeedbackOnNextApply = false;
      }
      published = true;

      // Publication has completed. Every remaining operation retires the old
      // generation best-effort; failures are warnings and never roll back or
      // invalidate the newly installed generation.
      for (const [name, pipeline] of previousPipelines) {
        if (nextPipelines.get(name) !== pipeline) {
          this.retireAfterPublication(`render pipeline ${name}`, () => pipeline.dispose(), graph.warnings);
        }
      }
      for (const [name, pipeline] of previousComputePipelines) {
        if (nextComputePipelines.get(name) !== pipeline) {
          this.retireAfterPublication(`compute pipeline ${name}`, () => pipeline.dispose(), graph.warnings);
        }
      }
      if (candidateResourceManager && previousResourceManager !== candidateResourceManager) {
        this.retireAfterPublication(
          "resource manager",
          () => previousResourceManager?.dispose(),
          graph.warnings,
        );
      }
      for (const [name, buffer] of retiredStorageBuffers) {
        this.retireAfterPublication(`storage buffer ${name}`, () => buffer.destroy(), graph.warnings);
      }
      if (sessionChanged) {
        if (hadInstalledPipeline) {
          this.retireAfterPublication(
            "previous shader time state",
            () => this.timeManager.cleanup(),
            graph.warnings,
          );
        }
        this.retireAfterPublication("previous canvas contents", () => this.clearCanvas(), graph.warnings);
      }
      if (!candidateResourceManager && this.resourceManager) {
        const shaderTime = this.timeManager.getCurrentTime(performance.now());
        this.retireAfterPublication(
          "installed video synchronization",
          () => this.resourceManager?.syncAllVideosToTime?.(shaderTime),
          graph.warnings,
        );
        if (this.timeManager.isPaused()) {
          this.retireAfterPublication(
            "installed video pause state",
            () => this.resourceManager?.pauseAllVideos?.(),
            graph.warnings,
          );
        } else {
          this.retireAfterPublication(
            "installed video playback state",
            () => this.resourceManager?.resumeAllVideos?.(),
            graph.warnings,
          );
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
      return { success: true, warnings: graph.warnings.length > 0 ? graph.warnings : undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (published) {
        graph.warnings.push(`Post-publication cleanup failed: ${message}`);
        return { success: true, warnings: graph.warnings };
      }
      errors.push(message);
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
      return this.failedCompilation(path, generation, {
        success: false,
        errors,
        warnings: graph.warnings,
      });
    } finally {
      if (preparedStorage) {
        this.discardPreparedStorage(preparedStorage);
      }
      if (pipelineCandidates) {
        this.discardPipelineCandidates(pipelineCandidates);
      } else {
        try {
          candidateResourceManager?.dispose();
        } catch {
          // Candidate construction/setup already failed; cleanup is best
          // effort and must not replace the structured compilation result.
        }
      }
    }
  }

  private validateStorageLimits(storage: StorageBindingNode[]): string[] {
    if (!this.device) {
      return ["WebGPU device unavailable while validating storage buffers"];
    }

    const grantedCountLimit = this.device.limits?.maxStorageBuffersPerShaderStage;
    const maxStorageBuffers = typeof grantedCountLimit === "number" &&
      Number.isFinite(grantedCountLimit) && grantedCountLimit > 0
      ? Math.floor(grantedCountLimit)
      : DEFAULT_MAX_STORAGE_BUFFERS_PER_SHADER_STAGE;
    const grantedSizeLimit = this.device.limits?.maxStorageBufferBindingSize;
    const maxStorageBufferSize = typeof grantedSizeLimit === "number" &&
      Number.isFinite(grantedSizeLimit) && grantedSizeLimit > 0
      ? Math.floor(grantedSizeLimit)
      : DEFAULT_MAX_STORAGE_BUFFER_BINDING_SIZE;
    const errors: string[] = [];
    if (storage.length > maxStorageBuffers) {
      errors.push(
        `Storage config declares ${storage.length} buffers, but the device ` +
        `maxStorageBuffersPerShaderStage limit is ${maxStorageBuffers}; ` +
        "pack related buffers into structs to reduce the buffer count",
      );
    }
    for (const node of storage) {
      const byteSize = node.count * node.stride;
      if (byteSize % 4 !== 0) {
        errors.push(
          `Storage ${node.name} requires ${byteSize} bytes, but its byte size ` +
          "must be a multiple of 4 for a WebGPU storage binding",
        );
      }
      if (byteSize > maxStorageBufferSize) {
        errors.push(
          `Storage ${node.name} requires ${byteSize} bytes, but the device ` +
          `maxStorageBufferBindingSize limit is ${maxStorageBufferSize} bytes; ` +
          "reduce its size or pack related data into structs",
        );
      }
    }
    if (errors.length > 0) {
      return errors;
    }

    return [];
  }

  private resolveComputeWorkgroupLimit(): number {
    const grantedLimit = this.device?.limits?.maxComputeWorkgroupsPerDimension;
    return typeof grantedLimit === "number" && Number.isFinite(grantedLimit) && grantedLimit > 0
      ? Math.floor(grantedLimit)
      : DEFAULT_MAX_COMPUTE_WORKGROUPS_PER_DIMENSION;
  }

  private resolveComputeWorkgroupLimits(): ComputeWorkgroupLimits {
    const limits = this.device?.limits;
    const resolve = (value: number | undefined, fallback: number): number => (
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback
    );
    return {
      maxInvocations: resolve(
        limits?.maxComputeInvocationsPerWorkgroup,
        DEFAULT_MAX_COMPUTE_INVOCATIONS_PER_WORKGROUP,
      ),
      maxSizeX: resolve(limits?.maxComputeWorkgroupSizeX, DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_X),
      maxSizeY: resolve(limits?.maxComputeWorkgroupSizeY, DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Y),
      maxSizeZ: resolve(limits?.maxComputeWorkgroupSizeZ, DEFAULT_MAX_COMPUTE_WORKGROUP_SIZE_Z),
    };
  }

  private validateStaticComputeDispatchLimits(
    passes: RenderPassNode[],
    storage: StorageBindingNode[],
  ): string[] {
    const storageLayouts = new Map(storage.map((node) => [node.name, node]));
    const limit = this.resolveComputeWorkgroupLimit();
    const errors: string[] = [];
    for (const pass of passes) {
      if (pass.kind !== "compute" || pass.dispatch?.mode === "cover-channel") {
        continue;
      }
      const counts = resolveWorkgroupCounts(pass, storageLayouts, []);
      if (counts) {
        const error = validateWorkgroupCounts(pass.name, counts, limit);
        if (error) {
          errors.push(error);
        }
      }
    }
    return errors;
  }

  private prepareStorageBuffers(
    storage: StorageBindingNode[],
    generation: number,
    forceFresh = false,
  ): PreparedStorageBuffers {
    if (!this.device) {
      throw new Error("WebGPU device unavailable while allocating storage buffers");
    }
    const STORAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x0080;
    const COPY_SRC = globalThis.GPUBufferUsage?.COPY_SRC ?? 0x0004;
    const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
    const nextBuffers = new Map<string, GPUBuffer>();
    const nextKeys = new Map<string, string>();
    const nextLayouts = new Map<string, StorageBindingNode>();
    const stagedBuffers: GPUBuffer[] = [];
    try {
      for (const node of storage) {
        const key = WebGPURenderingEngine.storageCacheKey(node);
        const existing = this.storageBuffers.get(node.name);
        let buffer: GPUBuffer;
        if (
          !forceFresh &&
          !this.resetStorageOnNextSync &&
          existing &&
          this.storageKeys.get(node.name) === key
        ) {
          buffer = existing;
        } else {
          buffer = this.device.createBuffer({
            size: node.count * node.stride,
            usage: STORAGE | COPY_SRC | COPY_DST,
          });
          stagedBuffers.push(buffer);
        }
        nextBuffers.set(node.name, buffer);
        nextKeys.set(node.name, key);
        nextLayouts.set(node.name, { ...node });
      }
    } catch (error) {
      for (const buffer of stagedBuffers) {
        buffer.destroy();
      }
      throw error;
    }

    const prepared: PreparedStorageBuffers = {
      generation,
      buffers: nextBuffers,
      keys: nextKeys,
      layouts: nextLayouts,
      stagedBuffers,
      settled: false,
    };
    this.pendingStoragePreparations.add(prepared);
    return prepared;
  }

  private collectRetiredStorageBuffers(
    prepared: PreparedStorageBuffers,
  ): Array<[string, GPUBuffer]> {
    return [...this.storageBuffers].filter(([name, buffer]) =>
      prepared.buffers.get(name) !== buffer);
  }

  private resolveStorageRange(
    name: string,
    start: number,
    count: number,
  ): { buffer: GPUBuffer; layout: StorageBindingNode; offset: number; size: number } {
    const layout = this.storageLayouts.get(name);
    const buffer = this.storageBuffers.get(name);
    if (!layout || !buffer) {
      throw new Error(`Storage buffer "${name}" is not available`);
    }
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count <= 0 || start + count > layout.count) {
      throw new Error(`Storage buffer "${name}" has an invalid element range`);
    }
    const offset = start * layout.stride;
    const size = count * layout.stride;
    if (offset % 4 !== 0 || size % 4 !== 0) {
      throw new Error(`Storage buffer "${name}" inspection requires a 4-byte-aligned stride`);
    }
    return { buffer, layout, offset, size };
  }

  private publishPreparedStorage(prepared: PreparedStorageBuffers): void {
    this.storageBuffers = prepared.buffers;
    this.storageKeys = prepared.keys;
    this.storageLayouts = prepared.layouts;
    this.resetStorageOnNextSync = false;
    prepared.settled = true;
    this.pendingStoragePreparations.delete(prepared);
  }

  private retireAfterPublication(
    resource: string,
    retire: () => void,
    warnings: string[],
  ): void {
    try {
      retire();
    } catch (error) {
      warnings.push(`Failed to retire ${resource}: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  private discardPreparedStorage(prepared: PreparedStorageBuffers): void {
    if (prepared.settled) {
      return;
    }
    prepared.settled = true;
    this.pendingStoragePreparations.delete(prepared);
    for (const buffer of prepared.stagedBuffers) {
      try {
        buffer.destroy();
      } catch {
        // A failed candidate owns no live state. Continue releasing its other
        // resources even if one driver-backed destroy call fails.
      }
    }
  }

  private preparePipelineCandidates(
    generation: number,
    resourceManager: ResourceManager<WebGPUTextureHandle> | null,
  ): PendingPipelineCandidates {
    const candidates: PendingPipelineCandidates = {
      generation,
      render: new Set(),
      compute: new Set(),
      resourceManager,
      resourceLoadsPending: 0,
      resourceManagerDisposed: false,
      installed: false,
      settled: false,
    };
    this.pendingPipelineCandidates.add(candidates);
    return candidates;
  }

  private async trackCandidateResourceLoad<T>(
    candidates: PendingPipelineCandidates,
    load: () => Promise<T>,
    resourceManager?: ResourceManager<WebGPUTextureHandle>,
  ): Promise<T> {
    candidates.resourceLoadsPending++;
    try {
      return await load();
    } finally {
      candidates.resourceLoadsPending--;
      if (
        this.disposed &&
        candidates.resourceLoadsPending === 0 &&
        resourceManager &&
        candidates.resourceManager !== resourceManager
      ) {
        resourceManager.cleanup();
      }
    }
  }

  private registerPipelineCandidate(
    candidates: PendingPipelineCandidates,
    pipeline: SlangPassPipeline | SlangComputePipeline,
  ): boolean {
    if (candidates.settled) {
      try {
        pipeline.dispose();
      } catch {
        // The transaction was already cancelled; disposal is best effort and
        // must not let a late async rebuild reject its superseded compile.
      }
      return false;
    }
    if (pipeline instanceof SlangComputePipeline) {
      candidates.compute.add(pipeline);
    } else {
      candidates.render.add(pipeline);
    }
    return true;
  }

  private installPipelineCandidates(candidates: PendingPipelineCandidates): void {
    candidates.installed = true;
    candidates.settled = true;
    candidates.render.clear();
    candidates.compute.clear();
    this.pendingPipelineCandidates.delete(candidates);
  }

  private discardPipelineCandidates(candidates: PendingPipelineCandidates): void {
    if (candidates.installed) {
      return;
    }
    if (!candidates.settled) {
      candidates.settled = true;
      this.pendingPipelineCandidates.delete(candidates);
      for (const pipeline of candidates.render) {
        try {
          pipeline.dispose();
        } catch {
          // Best-effort candidate teardown must not mask the compile result or
          // prevent the remaining candidate resources from being released.
        }
      }
      for (const pipeline of candidates.compute) {
        try {
          pipeline.dispose();
        } catch {
          // See render candidate teardown above.
        }
      }
      candidates.render.clear();
      candidates.compute.clear();
    }
    const resourceManager = candidates.resourceManager;
    const shouldDisposeResourceManager = resourceManager && (
      !candidates.resourceManagerDisposed || candidates.resourceLoadsPending === 0
    );
    if (shouldDisposeResourceManager) {
      candidates.resourceManagerDisposed = true;
      try {
        resourceManager.dispose();
      } catch {
        // Candidate cleanup remains best effort for the same reason as pipeline
        // teardown: publication never transferred ownership of this manager.
      }
    }
    if (candidates.resourceLoadsPending === 0) {
      candidates.resourceManager = null;
    }
  }

  private prepareResetStorageBuffers(): Map<string, GPUBuffer> | null {
    if (!this.device || this.storageLayouts.size === 0) {
      return null;
    }
    const STORAGE = globalThis.GPUBufferUsage?.STORAGE ?? 0x0080;
    const COPY_SRC = globalThis.GPUBufferUsage?.COPY_SRC ?? 0x0004;
    const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
    const nextBuffers = new Map<string, GPUBuffer>();
    const stagedBuffers: GPUBuffer[] = [];
    try {
      for (const node of this.storageLayouts.values()) {
        const buffer = this.device.createBuffer({
          size: node.count * node.stride,
          usage: STORAGE | COPY_SRC | COPY_DST,
        });
        stagedBuffers.push(buffer);
        nextBuffers.set(node.name, buffer);
      }
    } catch (error) {
      for (const buffer of stagedBuffers) {
        try {
          buffer.destroy();
        } catch {
          // Preserve the allocation failure and keep releasing the rest of
          // this unpublished reset candidate.
        }
      }
      throw error;
    }
    return nextBuffers;
  }

  private failedCompilation(
    path: string,
    generation: number,
    result: CompilationResult,
  ): CompilationResult {
    if (generation !== this.compileGeneration || this.disposed) {
      return { success: false, errors: ["Superseded by a newer compile"], superseded: true };
    }

    if (this.shaderPath !== "" && this.shaderPath !== path) {
      this.discardInstalledGeneration();
      this.stopRenderLoop();
      this.clearCanvas();
    }

    return result;
  }

  /** Release the active shader after switching to a different shader fails. */
  private discardInstalledGeneration(): void {
    const passPipelines = [...this.passPipelines.values()];
    const computePipelines = [...this.computePipelines.values()];
    const resourceManager = this.resourceManager;

    this.passPipelines.clear();
    this.passKeys.clear();
    this.computePipelines.clear();
    this.computeKeys.clear();
    this.passGraph = [];
    this.dispatchOnceRan.clear();
    this.hasSubmittedFrameForInstalledGeneration = false;
    this.installedCompile = null;
    this.installedResourceKey = null;
    this.currentConfig = null;
    this.shaderPath = "";
    this.customUniformManager = new CustomUniformManager();
    this.resetFeedbackOnNextApply = false;

    for (const buffer of this.storageBuffers.values()) {
      try {
        buffer.destroy();
      } catch {
        // The failed switch must preserve its compilation error even when
        // best-effort GPU cleanup is unavailable.
      }
    }
    this.storageBuffers.clear();
    this.storageKeys.clear();
    this.storageLayouts.clear();
    this.resetStorageOnNextSync = false;

    for (const pipeline of [...passPipelines, ...computePipelines]) {
      try {
        pipeline.dispose();
      } catch {
        // See storage cleanup above.
      }
    }

    this.resourceManager = this.device
      ? new ResourceManager(new WebGPUTextureBackend(this.device))
      : null;
    this.resourceManager?.setGlobalAudioState(this.globalVolume, this.globalMuted);
    try {
      resourceManager?.dispose?.();
    } catch {
      // See storage cleanup above.
    }
    this.timeManager.cleanup();
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

  /** Inputs that can change generated WGSL. Runtime buffer sizes, dispatch
   * counts and texture dimensions deliberately stay out of this key. */
  private static wgslCacheKey(
    pass: RenderPassNode,
    commonCode: string,
    storage: StorageBindingNode[],
    customUniforms: { name: string; type: string }[] = [],
    modules: Array<{ moduleName: string; path: string; source: string }> = [],
  ): string {
    const channels = [...pass.channels]
      .sort((a, b) => a.slot - b.slot)
      .map((channel) => [channel.slot, channel.key, channel.kind]);
    const storageLayout = storage.map((node) => [
      node.name,
      node.elementType,
      node.builtin,
    ]);
    const hasOutput = pass.output === "texture";
    return JSON.stringify([
      SLANG_WGSL_CACHE_KEY_VERSION,
      pass.kind,
      pass.entryPoint,
      pass.source,
      pass.geometry,
      pass.vertexSrc,
      commonCode,
      channels,
      storageLayout,
      pass.workgroupSize,
      hasOutput,
      hasOutput ? pass.outputLayers : null,
      customUniforms,
      modules,
    ]);
  }

  /** GPU object/resource compatibility for reusing an installed pipeline. */
  private static pipelineCacheKey(
    pass: RenderPassNode,
    commonCode: string,
    storage: StorageBindingNode[],
    customUniforms: { name: string; type: string }[] = [],
    modules: Array<{ moduleName: string; path: string; source: string }> = [],
  ): string {
    const channels = [...pass.channels]
      .sort((a, b) => a.slot - b.slot)
      .map((channel) => [channel.slot, channel.key, channel.kind]);
    const storageLayout = storage.map((node) => [
      node.name,
      node.binding,
      node.elementType,
      node.builtin,
      node.count,
      node.stride,
    ]);
    return JSON.stringify([
      SLANG_PIPELINE_CACHE_KEY_VERSION,
      WebGPURenderingEngine.wgslCacheKey(
        pass,
        commonCode,
        storage,
        customUniforms,
        modules,
      ),
      pass.name,
      pass.kind,
      pass.width,
      pass.height,
      channels,
      storageLayout,
      pass.workgroupSize,
      pass.dispatch,
      pass.dispatchCount,
      pass.dispatchOnce,
      pass.output,
      pass.outputLayers,
    ]);
  }

  private static hasFileResources(passes: RenderPassNode[]): boolean {
    return passes.some((pass) => pass.channels.some((channel) =>
      channel.kind === "texture" || channel.kind === "video" ||
      channel.kind === "cubemap" || channel.kind === "audio"));
  }

  private static resourceLayoutKey(passes: RenderPassNode[]): string {
    return JSON.stringify(passes.flatMap((pass) => pass.channels.flatMap((channel) => {
      if (channel.kind === "texture") {
        return [[
          pass.name,
          channel.slot,
          channel.kind,
          channel.path,
          channel.filter,
          channel.wrap,
          channel.vflip,
          channel.grayscale,
        ]];
      }
      if (channel.kind === "video") {
        return [[
          pass.name,
          channel.slot,
          channel.kind,
          channel.path,
          channel.filter,
          channel.wrap,
          channel.vflip,
          channel.muted,
        ]];
      }
      if (channel.kind === "cubemap") {
        return [[
          pass.name,
          channel.slot,
          channel.kind,
          channel.path,
          channel.filter,
          channel.wrap,
          channel.vflip,
        ]];
      }
      if (channel.kind === "audio") {
        return [[
          pass.name,
          channel.slot,
          channel.kind,
          channel.path,
          channel.muted,
          channel.startTime,
          channel.endTime,
        ]];
      }
      return [];
    })));
  }

  private static prefixPassError(passName: string, error: string): string {
    return error.startsWith(`${passName}:`) ? error : `${passName}: ${error}`;
  }

  private static storageCacheKey(node: StorageBindingNode): string {
    return JSON.stringify([node.elementType, node.count, node.stride]);
  }

  private createPassPipeline(
    pass: RenderPassNode,
    storage: StorageBindingNode[],
    uniformBufferSize = createSlangCustomUniformLayout([]).size,
  ): SlangPassPipeline | SlangComputePipeline {
    if (!this.device) {
      throw new Error("WebGPU device unavailable while creating pass pipeline");
    }
    const channels = [...pass.channels]
      .sort((a, b) => a.slot - b.slot)
      .map((channel) => ({
        slot: channel.slot,
        key: channel.key,
        kind: channel.kind,
      }));
    return pass.kind === "compute"
      ? new SlangComputePipeline(this.device, {
        name: pass.name,
        width: pass.width,
        height: pass.height,
        hasOutput: pass.output === "texture",
        outputLayers: pass.outputLayers,
        workgroupSize: pass.workgroupSize,
        entryPoint: pass.entryPoint!,
        dispatchCount: pass.dispatchCount,
        channels,
        storage,
        uniformBufferSize,
      })
      : new SlangPassPipeline(this.device, this.format, {
        name: pass.name,
        width: pass.width,
        height: pass.height,
        output: pass.output === "canvas" ? "canvas" : "texture",
        geometry: pass.geometry,
        channels,
        storage,
        uniformBufferSize,
      });
  }

  /**
   * Re-read the live canvas immediately before publication. Pipelines already
   * owned by this transaction can resize in place; carried-over installed
   * pipelines are replaced with candidates so an allocation failure cannot
   * partially mutate the live graph.
   */
  private async reconcileCandidateResolutions(
    graph: ReturnType<typeof buildSlangPassGraph>,
    config: ShaderConfig | null,
    nextPipelines: Map<string, SlangPassPipeline>,
    nextKeys: Map<string, string>,
    nextComputePipelines: Map<string, SlangComputePipeline>,
    nextComputeKeys: Map<string, string>,
    candidates: PendingPipelineCandidates,
    generation: number,
    customUniforms: { name: string; type: string }[],
    slangModules: SlangSourceModule[],
  ): Promise<string[]> {
    const errors: string[] = [];
    while (generation === this.compileGeneration && !this.disposed) {
      this.updatePassGraphResolutions(graph.passes, config);
      for (const pass of graph.passes) {
        const passModules = slangModules
          .filter((module) => module.ownerPass === pass.name)
          .map(({ ownerPass: _ownerPass, ...module }) => module);
        const isCompute = pass.kind === "compute";
        const pipelines = isCompute ? nextComputePipelines : nextPipelines;
        const keys = isCompute ? nextComputeKeys : nextKeys;
        const pipeline = pipelines.get(pass.name);
        const finalKey = WebGPURenderingEngine.pipelineCacheKey(
          pass,
          graph.commonCode,
          graph.storage,
          customUniforms,
          passModules,
        );
        if (!pipeline || keys.get(pass.name) === finalKey) {
          continue;
        }

        const candidateOwned = isCompute
          ? candidates.compute.has(pipeline as SlangComputePipeline)
          : candidates.render.has(pipeline as SlangPassPipeline);
        if (candidateOwned) {
          try {
            pipeline.resize(pass.width, pass.height);
            keys.set(pass.name, finalKey);
          } catch (error) {
            errors.push(WebGPURenderingEngine.prefixPassError(
              pass.name,
              error instanceof Error ? error.message : String(error),
            ));
          }
          continue;
        }

        const wgslKey = WebGPURenderingEngine.wgslCacheKey(
          pass,
          graph.commonCode,
          graph.storage,
          customUniforms,
          passModules,
        );
        const wgsl = sharedSlangWgslCache.get(wgslKey);
        if (!wgsl) {
          errors.push(`${pass.name}: compiled WGSL unavailable during resolution reconciliation`);
          continue;
        }

        let replacement: SlangPassPipeline | SlangComputePipeline | undefined;
        try {
          replacement = this.createPassPipeline(
            pass,
            graph.storage,
            createSlangCustomUniformLayout(customUniforms).size,
          );
          if (!this.registerPipelineCandidate(candidates, replacement)) {
            return errors;
          }
          const wgslErrors = await replacement.rebuild(wgsl);
          errors.push(...wgslErrors.map((error) =>
            WebGPURenderingEngine.prefixPassError(pass.name, error)));
          if (wgslErrors.length === 0 &&
            generation === this.compileGeneration && !this.disposed) {
            if (isCompute) {
              nextComputePipelines.set(pass.name, replacement as SlangComputePipeline);
              nextComputeKeys.set(pass.name, finalKey);
            } else {
              nextPipelines.set(pass.name, replacement as SlangPassPipeline);
              nextKeys.set(pass.name, finalKey);
            }
          }
        } catch (error) {
          errors.push(WebGPURenderingEngine.prefixPassError(
            pass.name,
            error instanceof Error ? error.message : String(error),
          ));
        }
      }

      if (errors.length > 0 || generation !== this.compileGeneration || this.disposed) {
        return errors;
      }

      // A replacement rebuild awaited GPU work. If another resize landed in
      // that interval, loop once more and reconcile the candidate to it.
      this.updatePassGraphResolutions(graph.passes, config);
      const stable = graph.passes.every((pass) => {
        const keys = pass.kind === "compute" ? nextComputeKeys : nextKeys;
        return keys.get(pass.name) === WebGPURenderingEngine.pipelineCacheKey(
          pass,
          graph.commonCode,
          graph.storage,
          customUniforms,
          slangModules
            .filter((module) => module.ownerPass === pass.name)
            .map(({ ownerPass: _ownerPass, ...module }) => module),
        );
      });
      if (stable) {
        return errors;
      }
    }
    return errors;
  }

  render(time: number = performance.now()): void {
    this.renderFrame(time, false);
  }

  private renderFrame(time: number, capture: boolean, imageOnly = false): void {
    if (!this.device || !this.context) {
      return;
    }
    if (!capture && !this.shouldRenderFrame(time)) {
      return;
    }
    if (this.passGraph.length === 0) {
      // WebGL clears on every rendered frame without an Image pass. Repeating
      // the clear matters for WebGPU canvas presentation: a single submitted
      // clear during an async failed switch can otherwise leave an older
      // swap-chain image visible even though its pipeline has been removed.
      if (this.shaderPath !== "") {
        this.clearCanvas();
      }
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

    // A shader installed while paused still submits one complete initial
    // frame. TimeManager's frame stays at zero while paused, so the engine
    // owns this submission state instead of inferring it from iFrame.
    const skipBufferPasses = isPaused && this.hasSubmittedFrameForInstalledGeneration;

    const encoder = this.device.createCommandEncoder();
    let canvasTexture: GPUTexture | null = null;
    const encodedComputePasses = new Set<string>();
    const pendingDispatchOnce = new Set<string>();

    for (const pass of this.passGraph) {
      if (imageOnly || pass.kind !== "compute" || skipBufferPasses) {
        continue;
      }
      if (pass.dispatchOnce && this.dispatchOnceRan.has(pass.name)) {
        continue;
      }
      const pipeline = this.computePipelines.get(pass.name);
      const gpuPipeline = pipeline?.getPipeline();
      const uniformBuffer = pipeline?.getUniformBuffer();
      if (!pipeline || !gpuPipeline || !uniformBuffer) {
        continue;
      }

      const channelResources = this.getChannelResources(pass, isPaused, encodedComputePasses);
      const workgroupCounts = resolveWorkgroupCounts(
        pass,
        this.storageLayouts,
        channelResources ?? [],
      );
      if (channelResources === null || workgroupCounts === null) {
        continue;
      }
      if (validateWorkgroupCounts(
        pass.name,
        workgroupCounts,
        this.resolveComputeWorkgroupLimit(),
      )) {
        continue;
      }
      pipeline.rebuildBindGroups(channelResources, this.storageBuffers);
      const bindGroups = Array.from({ length: pass.dispatchCount }, (_, index) =>
        pipeline.getBindGroup(index));
      if (bindGroups.some((bindGroup) => bindGroup === null)) {
        continue;
      }

      const data = packShaderToyUniforms({
        width: pass.width,
        height: pass.height,
        ...frameInput,
        ...this.getChannelUniforms(pass),
      }, this.customUniformManager.getUniformInfo(), this.customUniformManager.getCurrentValues());
      this.device.queue.writeBuffer(uniformBuffer, 0, data);

      const computePass = encoder.beginComputePass();
      let operationFailed = false;
      try {
        computePass.setPipeline(gpuPipeline);
        for (const bindGroup of bindGroups) {
          computePass.setBindGroup(0, bindGroup!);
          computePass.dispatchWorkgroups(...workgroupCounts);
        }
      } catch (error) {
        operationFailed = true;
        throw error;
      } finally {
        try {
          computePass.end();
        } catch (endError) {
          if (!operationFailed) {
            throw endError;
          }
        }
      }
      if (pass.dispatchOnce) {
        pendingDispatchOnce.add(pass.name);
      }
      encodedComputePasses.add(pass.name);
    }

    for (const pass of this.passGraph) {
      if (pass.kind === "compute" || (imageOnly && pass.output !== "canvas")) {
        continue;
      }
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
      const channelResources = this.getChannelResources(pass, isPaused, encodedComputePasses);
      if (channelResources === null) {
        continue;
      }

      // Passes with channels or storage have no eager bind group: their
      // explicit layout requires live resources, so it must be (re)built
      // before the bind-group presence check.
      if (channelResources.length > 0 || this.storageLayouts.size > 0) {
        pipeline.rebuildBindGroup(channelResources, this.storageBuffers);
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
      if (pass.geometry && pass.geometry !== "fullscreen" && pipeline.getMeshUniformBuffer?.()) {
        const model = createModelMatrix({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
        const viewProjection = multiplyMatrices(
          this.meshCamera.getProjectionMatrix(pass.width / Math.max(pass.height, 1), "webgpu"),
          this.meshCamera.getViewMatrix(),
        );
        const normal = createNormalMatrix3(model);
        const meshData = new Float32Array(64);
        meshData.set(model, 0);
        meshData.set(viewProjection, 16);
        meshData.set([normal[0], normal[1], normal[2], 0, normal[3], normal[4], normal[5], 0, normal[6], normal[7], normal[8], 0, 0, 0, 0, 1], 32);
        meshData.set([...this.meshCamera.getPosition(), 1], 48);
        this.device.queue.writeBuffer(pipeline.getMeshUniformBuffer()!, 0, meshData);
      }

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
        ...(pass.geometry && pass.geometry !== "fullscreen" && pipeline.getDepthView?.() ? {
          depthStencilAttachment: { view: pipeline.getDepthView()!, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
        } : {}),
      });
      renderPass.setPipeline(pipeline.getPipeline()!);
      renderPass.setBindGroup(0, bindGroup);
      if (!pass.geometry || pass.geometry === "fullscreen") {
        renderPass.draw(3);
      } else {
        const mesh = pass.modelPath
          ? this.meshResources?.getModel(pass.name)
          : pass.geometry === "model" ? undefined : this.meshResources?.get(pass.geometry);
        console.info("[Shader Studio][Slang 3D] drawing mesh", {
          name: pass.name,
          geometry: pass.geometry,
          meshAvailable: Boolean(mesh),
        });
        if (mesh) {
          renderPass.setVertexBuffer(0, mesh.vertexBuffer);
          renderPass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
          renderPass.drawIndexed(mesh.indexCount);
        }
      }
      renderPass.end();
    }

    if (canvasTexture && this.canvas) {
      this.pixelRegionCapturer?.encodeAfterRender(encoder, canvasTexture, this.canvas.width, this.canvas.height);
    }
    this.device.queue.submit([encoder.finish()]);
    this.hasSubmittedFrameForInstalledGeneration = true;
    this.pixelRegionCapturer?.beginMappings();

    for (const passName of pendingDispatchOnce) {
      this.dispatchOnceRan.add(passName);
    }
    for (const passName of encodedComputePasses) {
      this.computePipelines.get(passName)?.swap();
    }

    if (!skipBufferPasses && !imageOnly) {
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
    encodedComputePasses: ReadonlySet<string> = new Set(),
  ): SlangChannelResource[] | null {
    const resources: SlangChannelResource[] = [];
    for (const channel of pass.channels) {
      if (channel.kind === "buffer") {
        const renderSource = this.passPipelines.get(channel.source);
        const computeSource = this.computePipelines.get(channel.source);
        const layer = channel.layer ?? 0;
        const textureView = computeSource
          ? channel.readFrom === "previous-frame" || !encodedComputePasses.has(channel.source)
            ? computeSource.getPreviousLayerOutputView(layer)
            : computeSource.getLayerOutputView(layer)
          : channel.readFrom === "previous-frame"
            ? renderSource?.getPreviousOutputView()
            : renderSource?.getCurrentOutputView();
        if (!textureView) {
          return null;
        }
        const size = computeSource?.getOutputSize?.() ?? renderSource?.getOutputSize?.();
        resources.push({ slot: channel.slot, textureView, ...size });
      } else if (channel.kind === "texture") {
        const handle = this.resourceManager?.getImageTextureCache()[channel.path]
          ?? this.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: handle.sampler,
          width: handle.width,
          height: handle.height,
        });
      } else if (channel.kind === "video") {
        const handle = this.resourceManager?.getVideoTexture(channel.path)
          ?? this.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: handle.sampler,
          width: handle.width,
          height: handle.height,
        });
      } else if (channel.kind === "cubemap") {
        const handle = this.resourceManager?.getCubemapTexture(channel.path);
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: handle.sampler,
          width: handle.width,
          height: handle.height,
        });
      } else if (channel.kind === "audio") {
        const handle = this.resourceManager?.getAudioTexture(channel.path)
          ?? this.resourceManager?.getDefaultTexture();
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: handle.sampler,
          width: handle.width,
          height: handle.height,
        });
      } else {
        const handle = this.resolveKeyboardHandle(skipInputUpdates);
        if (!handle) {
          return null;
        }
        resources.push({
          slot: channel.slot,
          textureView: handle.view,
          sampler: handle.sampler,
          width: handle.width,
          height: handle.height,
        });
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
      if (this.running) {
        // Resizing a canvas clears its current presentation. Match WebGL by
        // redrawing Image immediately; render it without advancing time or
        // swapping feedback buffers a second time.
        this.renderFrame(this.now(), true, true);
      }
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
    const resizedPasses = this.passGraph.map((pass) => ({ ...pass }));
    this.updatePassGraphResolutions(resizedPasses, this.currentConfig);
    let resizeEncoder: GPUCommandEncoder | null = null;
    const finishResizes: Array<() => void> = [];
    for (let index = 0; index < this.passGraph.length; index += 1) {
      const pass = this.passGraph[index];
      const resizedPass = resizedPasses[index];
      const sizeChanged = pass.width !== resizedPass.width || pass.height !== resizedPass.height;
      if (pass.kind === "compute") {
        const pipeline = this.computePipelines.get(pass.name);
        if (!pipeline) {
          pass.width = resizedPass.width;
          pass.height = resizedPass.height;
          continue;
        }
        pipeline.resize(resizedPass.width, resizedPass.height);
        pass.width = resizedPass.width;
        pass.height = resizedPass.height;
        const dispatchMode = pass.dispatch?.mode ?? "texel";
        if (
          pass.dispatchOnce &&
          sizeChanged &&
          (dispatchMode === "texel" || pass.output === "texture")
        ) {
          this.dispatchOnceRan.delete(pass.name);
        }
      } else {
        const pipeline = this.passPipelines.get(pass.name);
        if (sizeChanged && pass.output === "texture" && pipeline && this.device) {
          resizeEncoder ??= this.device.createCommandEncoder();
          const finishResize = pipeline.encodeResize(
            resizedPass.width,
            resizedPass.height,
            resizeEncoder,
          );
          if (finishResize) {
            finishResizes.push(finishResize);
          }
        } else {
          pipeline?.resize(resizedPass.width, resizedPass.height);
        }
        pass.width = resizedPass.width;
        pass.height = resizedPass.height;
      }
    }
    if (resizeEncoder && finishResizes.length > 0 && this.device) {
      this.device.queue.submit([resizeEncoder.finish()]);
      for (const finishResize of finishResizes) {
        finishResize();
      }
    }
  }

  private updatePassGraphResolutions(
    passes: RenderPassNode[],
    config: ShaderConfig | null,
  ): void {
    if (!this.canvas) {
      return;
    }
    const canvasWidth = Math.max(1, this.canvas.width);
    const canvasHeight = Math.max(1, this.canvas.height);
    for (const pass of passes) {
      const unclampedResolution = pass.output === "canvas"
        ? { width: canvasWidth, height: canvasHeight }
        : resolvePassResolution({
          passName: pass.name,
          passConfig: config?.passes?.[pass.name],
          canvasWidth,
          canvasHeight,
          // Resolution settings were already validated at compile time; a
          // resize cannot introduce new config errors.
          errors: [],
        });
      const resolution = this.clampResolutionToTextureLimit(unclampedResolution);
      pass.width = resolution.width;
      pass.height = resolution.height;
    }
  }

  getResourceManager(): ResourceManager<WebGPUTextureHandle> | null {
    return this.resourceManager;
  }

  async compileSlangDebugPlan(plan: DebugInstrumentationPlan): Promise<CompilationResult | undefined> {
    const root = plan.files.find((file) => file.uri === plan.rootUri);
    if (!root) {
      return { success: false, errors: ["Slang debug plan root is missing"] };
    }
    const planModules: SlangSourceModule[] = plan.files
      .filter((file) => file.uri !== root.uri)
      // A debug plan always compiles its generated wrapper as Image, even
      // when the selected source belongs to a compute pass.
      .map((file) => ({ ...file, ownerPass: "Image" }));
    const previous = this.lastCompile;
    const planModulePaths = new Set(planModules.map((module) => module.path));
    const modules = [
      ...(previous?.slangModules.filter((module) => !planModulePaths.has(module.path)) ?? []),
      ...planModules,
    ];
    const result = await this.compileShaderPipeline(
      root.source,
      previous?.config ?? this.currentConfig,
      previous?.path ?? root.path,
      previous?.buffers ?? {},
      previous?.customUniformDeclarations ?? this.customUniformManager.getDeclarations(),
      previous?.customUniformInfo ?? this.customUniformManager.getUniformInfo(),
      modules,
      previous?.slangSourcePath ?? root.path,
      previous?.slangSourcePaths,
    );
    if (!result || result.success || result.superseded) {
      return result;
    }

    const selectedSource = plan.files.find((file) => file.uri === plan.selectedSourceUri);
    const selectedLabel = selectedSource?.path ?? plan.selectedSourceUri;
    return {
      ...result,
      errors: (result.errors?.length ? result.errors : ["Unknown Slang debug compilation error"])
        .map((error) => error.includes(selectedLabel) || error.includes(plan.selectedSourceUri)
          ? error
          : `${selectedLabel}: ${error}`),
    };
  }

  getCurrentConfig(): ShaderConfig | null {
    return this.currentConfig;
  }

  async readStorageBuffer(name: string, start: number, count: number): Promise<StorageBufferSnapshot> {
    const { buffer, layout, offset, size } = this.resolveStorageRange(name, start, count);
    if (!this.device) {
      throw new Error("WebGPU device unavailable while reading storage buffer");
    }
    const COPY_DST = globalThis.GPUBufferUsage?.COPY_DST ?? 0x0008;
    const MAP_READ = globalThis.GPUBufferUsage?.MAP_READ ?? 0x0001;
    const readback = this.device.createBuffer({ size, usage: COPY_DST | MAP_READ });
    try {
      const encoder = this.device.createCommandEncoder({ label: `storage-readback-${name}` });
      encoder.copyBufferToBuffer(buffer, offset, readback, 0, size);
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(globalThis.GPUMapMode?.READ ?? 0x0001);
      const data = readback.getMappedRange().slice(0);
      readback.unmap();
      return { name, elementType: layout.elementType, stride: layout.stride, start, count, data };
    } finally {
      readback.destroy();
    }
  }

  async writeStorageBuffer(name: string, start: number, data: ArrayBuffer): Promise<void> {
    const layout = this.storageLayouts.get(name);
    const buffer = this.storageBuffers.get(name);
    if (!layout || !buffer) {
      throw new Error(`Storage buffer "${name}" is not available`);
    }
    if (!Number.isInteger(start) || start < 0 || start >= layout.count) {
      throw new Error(`Storage buffer "${name}" has an invalid element range`);
    }
    if (data.byteLength === 0 || data.byteLength % layout.stride !== 0) {
      throw new Error(`Storage buffer "${name}" write data does not match its stride`);
    }
    const count = data.byteLength / layout.stride;
    const { offset, size } = this.resolveStorageRange(name, start, count);
    if (size !== data.byteLength || !this.device) {
      throw new Error("WebGPU device unavailable while writing storage buffer");
    }
    this.device.queue.writeBuffer(buffer, offset, data);
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
    // Allocate the complete replacement before invalidating any live reset or
    // compile state. A failed allocation leaves the installed generation
    // usable and makes resetTime safe to retry.
    const resetStorageBuffers = this.prepareResetStorageBuffers();
    this.timeManager.cleanup();
    this.dispatchOnceRan.clear();
    this.hasSubmittedFrameForInstalledGeneration = false;
    this.compileGeneration++;
    for (const prepared of [...this.pendingStoragePreparations]) {
      this.discardPreparedStorage(prepared);
    }
    for (const candidates of [...this.pendingPipelineCandidates]) {
      this.discardPipelineCandidates(candidates);
    }
    if (resetStorageBuffers) {
      const retiredStorageBuffers = this.storageBuffers;
      this.storageBuffers = resetStorageBuffers;
      for (const buffer of retiredStorageBuffers.values()) {
        try {
          buffer.destroy();
        } catch {
          // Reset has already published the complete replacement. Retirement
          // is best effort and must not invalidate the new reset generation.
        }
      }
    }
    this.cameraManager.reset();
    this.resetFeedbackOnNextApply = true;
  }

  setInputEnabled(enabled: boolean): void {
    this.mouseManager.setEnabled(enabled);
    this.keyboardManager.setEnabled(enabled);
    this.cameraManager.setEnabled(enabled);
    this.meshCamera.setInputEnabled(enabled);
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
    this.pixelRegionCapturer?.cancelPendingCaptures();
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
    attempt(() => this.meshCamera.detach());

    const compiler = this.compiler;
    this.compiler = null;
    attempt(() => compiler?.dispose());

    const pixelRegionCapturer = this.pixelRegionCapturer;
    this.pixelRegionCapturer = null;
    attempt(() => pixelRegionCapturer?.dispose());

    const passPipelines = [...this.passPipelines.values()];
    const computePipelines = [...this.computePipelines.values()];
    this.passPipelines.clear();
    this.passKeys.clear();
    this.computePipelines.clear();
    this.computeKeys.clear();
    this.dispatchOnceRan.clear();
    this.hasSubmittedFrameForInstalledGeneration = false;
    this.passGraph = [];
    this.installedCompile = null;
    this.installedResourceKey = null;
    for (const prepared of [...this.pendingStoragePreparations]) {
      attempt(() => this.discardPreparedStorage(prepared));
    }
    for (const candidates of [...this.pendingPipelineCandidates]) {
      attempt(() => this.discardPipelineCandidates(candidates));
    }
    for (const buffer of this.storageBuffers.values()) {
      attempt(() => buffer.destroy());
    }
    this.storageBuffers.clear();
    this.storageKeys.clear();
    this.storageLayouts.clear();
    this.resetStorageOnNextSync = false;
    for (const pipeline of passPipelines) {
      attempt(() => pipeline.dispose());
    }
    for (const pipeline of computePipelines) {
      attempt(() => pipeline.dispose());
    }

    const resourceManager = this.resourceManager;
    this.resourceManager = null;
    const disposeResources = resourceManager?.dispose?.bind(resourceManager)
      ?? resourceManager?.cleanup?.bind(resourceManager);
    attempt(() => disposeResources?.());

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
  ): Promise<CompilationResult | undefined> {
    if (!this.lastCompile) {
      return { success: false, errors: ["Cannot update a buffer before a shader has been compiled"] };
    }
    this.lastCompile.buffers = { ...this.lastCompile.buffers, [bufferName]: bufferContent };
    return this.compileShaderPipeline(
      this.lastCompile.code,
      this.lastCompile.config,
      this.lastCompile.path,
      this.lastCompile.buffers,
      this.lastCompile.customUniformDeclarations,
      this.lastCompile.customUniformInfo,
      this.lastCompile.slangModules,
      this.lastCompile.slangSourcePath,
      this.lastCompile.slangSourcePaths,
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

  requestPixelRegion(requestId: number, centerX: number, centerY: number): boolean {
    return this.pixelRegionCapturer?.queue({
      requestId,
      centerX: Math.floor(centerX),
      centerY: Math.floor(centerY),
    }) ?? false;
  }

  collectPixelRegionResults(): PixelRegionResult[] {
    return this.pixelRegionCapturer?.collectResults() ?? [];
  }

  cancelPixelRegionRequests(): void {
    this.pixelRegionCapturer?.cancelPendingCaptures();
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
      () => this.storageBuffers,
    );
  }

  getVariableCaptureCompileContext(
    code?: string,
    passName?: string,
    sourcePath?: string | null,
  ): CaptureCompileContext {
    const snapshot = this.installedCompile ?? (this.disposed ? null : this.lastCompile);
    const graph = this.getVariableCapturePassGraph(snapshot);
    const configuredCommonCode = snapshot?.buffers.common ?? "";
    const isCapturingCommon = passName === "common"
      || (code !== undefined && code === configuredCommonCode);
    const targetPass = (passName
      ? graph.passes.find((pass) => pass.name === passName)
      : undefined) ?? (code
      ? graph.passes.find((pass) => pass.source === code)
      : undefined) ?? graph.passes.find((pass) => pass.name === "Image") ?? graph.passes[0];
    const ownerModules = (snapshot?.slangModules ?? [])
      .filter((module) => module.ownerPass === targetPass?.name);
    const selectedModuleIndex = sourcePath
      ? ownerModules.findIndex((module) => module.path === sourcePath)
      : -1;
    const selectedModule = selectedModuleIndex >= 0 ? ownerModules[selectedModuleIndex] : undefined;
    const commonCode = this.removeSelectedModuleImport(
      isCapturingCommon ? "" : configuredCommonCode,
      selectedModule?.moduleName,
    );
    const slangModules = (selectedModuleIndex >= 0
      ? ownerModules.slice(0, selectedModuleIndex)
      : ownerModules)
      .map(({ ownerPass: _ownerPass, ...module }) => module);
    this.capturePassName = targetPass?.name ?? null;
    return {
      commonCode,
      slangPassName: targetPass?.name,
      slangChannels: targetPass?.channels.map(({ slot, key, kind }) => ({ slot, key, kind })) ?? [],
      slangStorage: graph.storage,
      slangStorageBuffers: this.storageBuffers,
      slangModules,
      ...(sourcePath ? { slangSourcePath: sourcePath } : {}),
    };
  }

  private removeSelectedModuleImport(commonCode: string, moduleName?: string): string {
    if (!moduleName) {
      return commonCode;
    }
    const escapedName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return commonCode.replace(
      new RegExp(`^\\s*(?:__exported\\s+)?import\\s+${escapedName}\\s*;\\s*$`, "gm"),
      "",
    );
  }

  private getVariableCapturePassGraph(
    snapshot: ShaderCompileSnapshot | null,
  ): { passes: RenderPassNode[]; storage: StorageBindingNode[] } {
    if (this.passGraph.length > 0 || !snapshot) {
      return {
        passes: this.passGraph,
        storage: [...this.storageLayouts.values()],
      };
    }

    const graph = buildSlangPassGraph({
      imageCode: snapshot.code,
      config: snapshot.config,
      buffers: snapshot.buffers,
      canvasWidth: this.canvas?.width ?? 1,
      canvasHeight: this.canvas?.height ?? 1,
      computeWorkgroupLimits: this.resolveComputeWorkgroupLimits(),
    });
    return { passes: graph.passes, storage: graph.storage };
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
    this.globalVolume = Math.max(0, Math.min(1, volume));
    this.globalMuted = muted;
    this.resourceManager?.setGlobalAudioState(this.globalVolume, this.globalMuted);
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
