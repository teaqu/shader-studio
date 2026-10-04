import { geometryInstanceCount } from "../types/Geometry";
import { packDefaultMeshUniforms } from "./meshUniforms";
import { captureInstalledWgslTrace, traceDispatchUniforms, validateProjectTraceRequest, wgslTraceTargets } from "../trace/WgslProjectTraceController";
import { vertexPassKey } from "@shader-studio/types";
import type { WgslProjectTraceRequest, WgslTraceRecording } from "@shader-studio/types";
import { packShaderToyUniforms } from "./uniforms";
import { getShaderToyChannelCount } from "./SlangPrelude";
import { resolveWorkgroupCounts } from "./WebGPUDispatch";
import { audioPreviewData, livePreviewData, controlSystemAudio, controlAudioInput } from "../resources/MediaPreview";
import type { LiveInputType, LiveInputPreview } from "../resources/LiveInputTextureManager";
import type { DebugInstrumentationPlan,ShaderConfig,ShaderLanguageId,SlangSourceModule,StorageBufferSnapshot } from "@shader-studio/types";
import type {
  CaptureCompileContext,
  CaptureCustomUniform,
  CaptureUniforms,
  IVariableCapturer,
} from "../capture/VariableCapturer";
import { CameraManager } from "../input/CameraManager";
import { KeyboardManager } from "../input/KeyboardManager";
import { MouseManager } from "../input/MouseManager";
import type { CompilationResult,PassUniforms } from "../models";
import { OrbitCamera } from "../preview3d/OrbitCamera";
import { ResourceManager } from "../resources/ResourceManager";
import type { PixelRegionResult } from "../types/PixelRegion";
import type { RenderingEngine } from "../types/RenderingEngine";
import { ConfigValidator } from "../util/ConfigValidator";
import { FPSCalculator } from "../util/FPSCalculator";
import { TimeManager } from "../util/TimeManager";
import { type CustomUniform } from "../webgl/CustomUniformManager";
import { type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import {
  type RenderPassNode
} from "./SlangPassGraph";
import {
  BUFFER_TEXTURE_FORMAT,
  HIGH_PRECISION_BUFFER_TEXTURE_FORMAT
} from "./SlangPassPipeline";
import { WebGPUCapture } from "./WebGPUCapture";
import { WebGPUChannels } from "./WebGPUChannels";
import type { PendingReset,SlangAssetUrls } from "./WebGPUCompilationTypes";
import { WebGPUCompileDiagnostics } from "./WebGPUCompileDiagnostics";
import { WebGPUCompilerLoader } from "./WebGPUCompilerLoader";
import { WebGPUDeviceConstraints } from "./WebGPUDeviceConstraints";
import { WebGPUFrameRenderer } from "./WebGPUFrameRenderer";
import { WebGPUGeometry } from "./WebGPUGeometry";
import { WebGPUFrameTiming } from "./WebGPUFrameTiming";
import { WebGPUMeshResources } from "./WebGPUMeshResources";
import { WebGPUPassFactory } from "./WebGPUPassFactory";
import { WebGPUPipelineCandidates } from "./WebGPUPipelineCandidates";
import { WebGPUPixelRegionCapturer,type PixelRegionRequestStage } from "./WebGPUPixelRegionCapturer";
import { WebGPUShaderSession } from "./WebGPUShaderSession";
import { WebGPUStorage } from "./WebGPUStorage";
import { WebGPUTextureBackend,type WebGPUTextureHandle } from "./WebGPUTextureBackend";
export type { SlangAssetUrls } from "./WebGPUCompilationTypes";
export class WebGPURenderingEngine implements RenderingEngine {
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private bufferTextureFormat: GPUTextureFormat = BUFFER_TEXTURE_FORMAT;
  private ready: Promise<void> | null = null;
  private initError: string | null = null;


  private compiler: AsyncSlangCompiler | null = null;

  private meshResources: WebGPUMeshResources | null = null;
  private meshCamera = new OrbitCamera();

  private disposed = false;

  private globalVolume = 1;
  private globalMuted = false;

  private pixelRegionCapturer: WebGPUPixelRegionCapturer | null = null;


  private timeManager = new TimeManager();
  private mouseManager = new MouseManager();
  private keyboardManager = new KeyboardManager();
  private cameraManager = new CameraManager(this.keyboardManager);
  private fps = new FPSCalculator(60, 10);

  private running = false;
  private rafId: number | null = null;


  private readonly diagnostics: WebGPUCompileDiagnostics;
  private readonly constraints: WebGPUDeviceConstraints;
  private readonly storage: WebGPUStorage;
  private readonly candidates: WebGPUPipelineCandidates;
  private readonly compilerLoader: WebGPUCompilerLoader;
  private readonly timing: WebGPUFrameTiming;
  private readonly channels: WebGPUChannels;
  private readonly capture: WebGPUCapture;
  private readonly passFactory: WebGPUPassFactory;
  private readonly session: WebGPUShaderSession;
  private readonly frameRenderer: WebGPUFrameRenderer;
  private readonly geometry: WebGPUGeometry;

  constructor(private slangAssets?: SlangAssetUrls, private language: ShaderLanguageId = "slang") {
    const engine = this;
    this.diagnostics = new WebGPUCompileDiagnostics({
      get slangAssets() {
        return engine.slangAssets;
      },
    });
    this.constraints = new WebGPUDeviceConstraints({
      get canvas() {
        return engine.canvas;
      },
      get device() {
        return engine.device;
      },
    });
    this.storage = new WebGPUStorage({
      get device() {
        return engine.device;
      },
      retireAfterPublication: (resource, retire, warnings) => this.retireAfterPublication(resource, retire, warnings),
    });
    this.candidates = new WebGPUPipelineCandidates({
      get disposed() {
        return engine.disposed;
      },
    });
    this.compilerLoader = new WebGPUCompilerLoader({
      diagnostics: this.diagnostics,
      get language() {
        return engine.language;
      },
      get slangAssets() {
        return engine.slangAssets;
      },
      get disposed() {
        return engine.disposed;
      },
    });
    this.timing = new WebGPUFrameTiming({
      diagnostics: this.diagnostics,
      get running() {
        return engine.running;
      },
      get device() {
        return engine.device;
      },
      get disposed() {
        return engine.disposed;
      },
      get timeManager() {
        return engine.timeManager;
      },
    });
    this.geometry = new WebGPUGeometry({
      get meshResources() {
        return engine.meshResources;
      },
      get meshCamera() {
        return engine.meshCamera;
      },
    });
    this.passFactory = new WebGPUPassFactory({
      get session() {
        return engine.session;
      },
      candidates: this.candidates,
      constraints: this.constraints,
      get device() {
        return engine.device;
      },
      get bufferTextureFormat() {
        return engine.bufferTextureFormat;
      },
      get format() {
        return engine.format;
      },
      get disposed() {
        return engine.disposed;
      },
      get canvas() {
        return engine.canvas;
      },
    });
    this.session = new WebGPUShaderSession({
      storage: this.storage,
      candidates: this.candidates,
      diagnostics: this.diagnostics,
      constraints: this.constraints,
      passFactory: this.passFactory,
      resetPausedFrame: () => this.frameRenderer.resetPausedFrame(),
      get disposed() {
        return engine.disposed;
      },
      get ready() {
        return engine.ready;
      },
      get context() {
        return engine.context;
      },
      get device() {
        return engine.device;
      },
      get compiler() {
        return engine.compiler;
      },
      get initError() {
        return engine.initError;
      },
      describeUnavailableInitState: () => this.describeUnavailableInitState(),
      get canvas() {
        return engine.canvas;
      },
      get language() {
        return engine.language;
      },
      get globalVolume() {
        return engine.globalVolume;
      },
      get globalMuted() {
        return engine.globalMuted;
      },
      get meshResources() {
        return engine.meshResources;
      },
      get bufferTextureFormat() {
        return engine.bufferTextureFormat;
      },
      get timeManager() {
        return engine.timeManager;
      },
      get cameraManager() {
        return engine.cameraManager;
      },
      retireAfterPublication: (resource, retire, warnings) => this.retireAfterPublication(resource, retire, warnings),
      clearCanvas: () => this.clearCanvas(),
      stopRenderLoop: () => this.stopRenderLoop(),
    });
    this.channels = new WebGPUChannels({
      session: this.session,
      get device() {
        return engine.device;
      },
      get keyboardManager() {
        return engine.keyboardManager;
      },
    });
    this.capture = new WebGPUCapture({
      session: this.session,
      geometry: this.geometry,
      channels: this.channels,
      storage: this.storage,
      constraints: this.constraints,
      get device() {
        return engine.device;
      },
      get compiler() {
        return engine.compiler;
      },
      get timeManager() {
        return engine.timeManager;
      },
      get disposed() {
        return engine.disposed;
      },
      get language() {
        return engine.language;
      },
      get canvas() {
        return engine.canvas;
      },
      getUniforms: () => this.getUniforms(),
    });
    this.frameRenderer = new WebGPUFrameRenderer({
      timing: this.timing,
      session: this.session,
      channels: this.channels,
      storage: this.storage,
      constraints: this.constraints,
      get device() {
        return engine.device;
      },
      get context() {
        return engine.context;
      },
      clearCanvas: () => this.clearCanvas(),
      get timeManager() {
        return engine.timeManager;
      },
      get fps() {
        return engine.fps;
      },
      get cameraManager() {
        return engine.cameraManager;
      },
      get mouseManager() {
        return engine.mouseManager;
      },
      get meshCamera() {
        return engine.meshCamera;
      },
      geometry: this.geometry,
      get canvas() {
        return engine.canvas;
      },
      get pixelRegionCapturer() {
        return engine.pixelRegionCapturer;
      },
      get keyboardManager() {
        return engine.keyboardManager;
      },
    });
  }

  initialize(glCanvas: HTMLCanvasElement, _preserveDrawingBuffer = false): void {
    if (this.disposed) {
      return;
    }

    const initStartedAt = this.diagnostics.now();
    this.diagnostics.logSlangPerf("init start", {
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
      this.diagnostics.logSlangPerf("init failed", {
        reason: this.initError,
        totalMs: this.diagnostics.ms(this.diagnostics.now() - initStartedAt),
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

  private async initDevice(initStartedAt = this.diagnostics.now()): Promise<void> {
    try {
      if (!navigator.gpu) {
        throw new Error("navigator.gpu is undefined");
      }
      const adapterStartedAt = this.diagnostics.now();
      this.diagnostics.logSlangPerf("adapter request start", {});
      const adapter = await navigator.gpu.requestAdapter();
      const adapterMs = this.diagnostics.now() - adapterStartedAt;
      if (this.disposed) {
        return;
      }
      if (!adapter) {
        throw new Error("requestAdapter() returned null");
      }
      ConfigValidator.setChannelLimit(this.constraints.resolveChannelLimit(adapter.limits));
      const deviceStartedAt = this.diagnostics.now();
      this.diagnostics.logSlangPerf("device request start", {});
      const deviceDescriptor = this.constraints.buildDeviceDescriptor(adapter);
      const device = deviceDescriptor
        ? await adapter.requestDevice(deviceDescriptor)
        : await adapter.requestDevice();
      const deviceMs = this.diagnostics.now() - deviceStartedAt;
      if (this.disposed) {
        device.destroy?.();
        return;
      }
      this.device = device;
      ConfigValidator.setChannelLimit(this.constraints.resolveChannelLimit(device.limits));
      this.meshResources = new WebGPUMeshResources(device);
      this.bufferTextureFormat = HIGH_PRECISION_BUFFER_TEXTURE_FORMAT;
      this.constraints.maxTextureDimension2D = this.constraints.resolveDeviceTextureLimit(device);
      this.constraints.clampCanvasToTextureLimit();
      this.session.resourceManager = new ResourceManager(new WebGPUTextureBackend(this.device));
      this.session.resourceManager.setGlobalAudioState(this.globalVolume, this.globalMuted);
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.diagnostics.logSlangPerf("context configure", { format: this.format });
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

      const compilerStartedAt = this.diagnostics.now();
      this.diagnostics.logSlangPerf("compiler create start", {});
      const compiler = await this.createCompiler();
      if (this.disposed) {
        compiler.dispose();
        return;
      }
      this.compiler = compiler;
      this.diagnostics.logSlangPerf("init complete", {
        bufferTextureFormat: this.bufferTextureFormat,
        adapterMs: this.diagnostics.ms(adapterMs),
        deviceMs: this.diagnostics.ms(deviceMs),
        compilerMs: this.diagnostics.ms(this.diagnostics.now() - compilerStartedAt),
        totalMs: this.diagnostics.ms(this.diagnostics.now() - initStartedAt),
      });
    } catch (e) {
      if (this.disposed) {
        return;
      }
      this.initError = e instanceof Error ? e.message : String(e);
      this.diagnostics.logSlangPerf("init failed", {
        reason: this.initError,
        totalMs: this.diagnostics.ms(this.diagnostics.now() - initStartedAt),
      });
    }
  }

  private async createCompiler(): Promise<AsyncSlangCompiler> {
    return this.compilerLoader.createCompiler();
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
    return this.session.compileShaderPipeline(code, config, path, buffers, customUniformDeclarations, customUniformInfo, slangModules, slangSourcePath, slangSourcePaths);
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

  getGpuFrameTimeMs(): number | null {
    return this.timing.getGpuFrameTimeMs();
  }

  setGpuTimingEnabled(enabled: boolean): void {
    return this.timing.setGpuTimingEnabled(enabled);
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

  render(time: number = performance.now()): void {
    this.frameRenderer.renderFrame(time, false);
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
      // Only loop frames are paced; an explicit render() must always produce
      // the frame it was asked for.
      if (!this.timing.shouldWaitForGpu(t)) {
        this.render(t);
      }
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
    const w = this.constraints.clampDimensionToTextureLimit(width);
    const h = this.constraints.clampDimensionToTextureLimit(height);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.passFactory.applyPassResolutions();
      if (this.running) {
        // Resizing a canvas clears its current presentation. Match WebGL by
        // redrawing Image immediately; render it without advancing time or
        // swapping feedback buffers a second time.
        this.frameRenderer.renderFrame(this.diagnostics.now(), true, true);
      }
    }
  }


  getResourceManager(): ResourceManager<WebGPUTextureHandle> | null {
    return this.session.resourceManager;
  }
  async compileDebugPlan(
    plan: DebugInstrumentationPlan,
    config?: ShaderConfig | null,
  ): Promise<CompilationResult | undefined> {
    return this.session.compileDebugPlan(plan, config);
  }


  getCurrentConfig(): ShaderConfig | null {
    return this.session.currentConfig;
  }
  async readStorageBuffer(name: string, start: number, count: number): Promise<StorageBufferSnapshot> {
    return this.storage.readStorageBuffer(name, start, count);
  }

  async writeStorageBuffer(name: string, start: number, data: ArrayBuffer): Promise<void> {
    return this.storage.writeStorageBuffer(name, start, data);
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
    this.session.resourceManager?.syncAllVideosToTime(shaderTime);
    this.session.resourceManager?.syncAllAudioToTime(shaderTime);

    if (wasPaused) {
      this.session.resourceManager?.resumeAllVideos();
      this.session.resourceManager?.resumeAllAudio();
    } else {
      this.session.resourceManager?.pauseAllVideos();
      this.session.resourceManager?.pauseAllAudio();
    }
  }

  resetTime(): void {
    // Allocate the complete storage replacement before invalidating any live
    // compile state. Until a matching compilation publishes, the installed
    // pipeline, feedback, storage, clock, and pause snapshot remain untouched.
    const storageBuffers = this.storage.prepareResetStorageBuffers();
    const pendingReset: PendingReset = {
      generation: ++this.storage.resetGeneration,
      storageBuffers,
      storageKeys: new Map(this.storage.storageKeys),
    };
    const previousReset = this.storage.pendingReset;
    this.storage.pendingReset = pendingReset;
    this.session.compileGeneration++;
    for (const prepared of [...this.storage.pendingStoragePreparations]) {
      this.storage.discardPreparedStorage(prepared);
    }
    for (const candidates of [...this.candidates.pendingPipelineCandidates]) {
      this.candidates.discardPipelineCandidates(candidates);
    }
    if (previousReset) {
      this.storage.discardPendingReset(previousReset);
    }
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
      channelTime: new Array<number>(4).fill(0),
      sampleRate: this.session.resourceManager?.getAudioSampleRate?.() || 44100,
      channelLoaded: new Array<number>(4).fill(0),
      cameraPos: Array.from(this.cameraManager.getCameraPos()),
      cameraDir: Array.from(this.cameraManager.getCameraDir()),
    };
  }

  cleanup(): void {
    this.stopRenderLoop();
    this.pixelRegionCapturer?.cancelPendingCaptures();
    this.timeManager.cleanup();
    this.session.resourceManager?.cleanup();
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

    attempt(() => this.compilerLoader.abortLoading());
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

    const disposePipelines = this.session.detachPipelines();
    this.storage.discardPendingPreparations(attempt);
    this.candidates.dispose(attempt);
    this.storage.disposeBuffers(attempt);
    disposePipelines(attempt);
    attempt(() => this.session.disposeResources());

    const device = this.device;
    this.device = null;
    attempt(() => device?.destroy?.());

    if (hasError) {
      throw firstError;
    }
  }
  async updateBufferAndRecompile(
    bufferName: string,
    bufferContent: string,
  ): Promise<CompilationResult | undefined> {
    return this.session.updateBufferAndRecompile(bufferName, bufferContent);
  }


  getPasses(): RenderPassNode[] {
    return this.session.passGraph;
  }

  // ---- Not yet supported in the Slang/WebGPU path ----

  flagReloadOnNextApply(): void {
    this.session.reloadOnNextApply = true;
  }
  getFrameTimeHistory(): number[] {
    return this.timing.getFrameTimeHistory();
  }

  getGpuFrameTimeHistory(): number[] {
    return this.timing.getGpuFrameTimeHistory();
  }

  getFrameTimeCount(): number {
    return this.timing.getFrameTimeCount();
  }

  setFPSLimit(limit: number): void {
    return this.timing.setFPSLimit(limit);
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

  /** Diagnostic: where a pixel-region request is in the readback pipeline. */
  getPixelRegionRequestStage(requestId: number): PixelRegionRequestStage | null {
    return this.pixelRegionCapturer?.getRequestStage(requestId) ?? null;
  }

  cancelPixelRegionRequests(): void {
    this.pixelRegionCapturer?.cancelPendingCaptures();
  }
  createVariableCapturer(): IVariableCapturer {
    return this.capture.createVariableCapturer();
  }

  getVariableCaptureCompileContext(
    code?: string,
    passName?: string,
    sourcePath?: string | null,
  ): CaptureCompileContext {
    return this.capture.getVariableCaptureCompileContext(code, passName, sourcePath);
  }

  getShaderLanguage(): ShaderLanguageId {
    return this.language;
  }
  getWgslTraceTargets() {
    return this.language === "wgsl" ? wgslTraceTargets(this.session.passGraph, this.session.installedCompile) : [];
  }

  captureWgslProjectTrace(request: WgslProjectTraceRequest, signal?: AbortSignal): Promise<WgslTraceRecording> {
    return this.captureWgslProjectTraceWithMode(request, signal);
  }

  captureWgslProjectReference(request: WgslProjectTraceRequest, signal?: AbortSignal): Promise<WgslTraceRecording> {
    return this.captureWgslProjectTraceWithMode(request, signal, true);
  }

  private async captureWgslProjectTraceWithMode(request: WgslProjectTraceRequest, signal?: AbortSignal, reference = false): Promise<WgslTraceRecording> {
    const target = validateProjectTraceRequest(request, this.getWgslTraceTargets());
    if (!this.device || !this.session.installedCompile) {
      throw new Error("WGSL preview is not ready.");
    }
    const generation = this.session.compileGeneration;
    const installedPass = this.session.passGraph.find(candidate => candidate.name === target.passName)!;
    const sources = new Map(request.sources?.map(source => [source.path, source.source]) ?? []);
    const paths = this.session.installedCompile.slangSourcePaths ?? {};
    const rootTarget = this.getWgslTraceTargets().find(candidate => candidate.passName === target.passName && candidate.stage !== "vertex")!;
    const pass = { ...installedPass, source: sources.get(rootTarget.path) ?? installedPass.source,
      vertexSrc: sources.get(paths[vertexPassKey(installedPass.name)] ?? "") ?? installedPass.vertexSrc };
    const project = this.session.installedCompile;
    const resources = this.channels.getChannelResources(pass, true, new Set(this.session.computePipelines.keys()));
    if (!resources) {
      throw new Error("The pass input resources are not ready.");
    }
    const camera = this.geometry.passCameraMatrices(pass);
    const uniformData = packShaderToyUniforms({ vertexCount: this.geometry.resolvePassVertexCount(pass), instanceCount: geometryInstanceCount(pass),
      viewMatrix: camera.view, projectionMatrix: camera.projection, viewProjection: camera.viewProjection, channelCount: getShaderToyChannelCount(pass.channels),
      width: pass.width, height: pass.height, ...this.getUniforms(), ...this.channels.getChannelUniforms(pass),
    }, this.session.customUniformManager.getUniformInfo(), this.getCurrentCustomUniforms());
    const mesh = this.getTraceMesh(pass);
    return captureInstalledWgslTrace({ device: this.device, pass, storage: [...this.storage.storageLayouts.values()],
      storageBuffers: this.storage.storageBuffers, channelResources: resources, uniformData,
      commonCode: sources.get(paths.common ?? "") ?? project.buffers.common ?? "", customUniformInfo: this.session.customUniformManager.getUniformInfo(),
      sourcePath: this.getWgslTraceTargets().find(candidate => candidate.passName === pass.name && candidate.stage !== "vertex")!.path,
      commonPath: paths.common, vertexPath: paths[vertexPassKey(pass.name)], mesh,
      ...(pass.geometry !== "fullscreen" ? { meshUniformData: packDefaultMeshUniforms(this.meshCamera, pass.width, pass.height).buffer as ArrayBuffer } : {}),
      dispatchWorkgroups: resolveWorkgroupCounts(pass, this.storage.storageLayouts, resources) ?? undefined,
      dispatchUniforms: traceDispatchUniforms(pass.dispatchCount),
    }, { ...target, source: sources.get(target.path) ?? target.source }, request, signal, () => !this.disposed && generation === this.session.compileGeneration, reference);
  }

  private getTraceMesh(pass: RenderPassNode) {
    return this.geometry.resolvePassMesh(pass);
  }

  getCaptureUniforms(): CaptureUniforms {
    return this.capture.getCaptureUniforms();
  }


  renderForCapture(): void {
    this.frameRenderer.renderFrame(performance.now(), true);
  }

  // ---- Audio/video ----

  async resumeAudioContext(): Promise<void> {
    await this.session.resourceManager?.resumeAudioContext();
  }
  resumeAllAudio(): void {
    this.session.resourceManager?.resumeAllAudio();
  }
  resumeAllVideos(): void {
    this.session.resourceManager?.resumeAllVideos();
  }
  releaseMediaResetHold(): void {}
  updateAudioLoopRegion(path: string, startTime?: number, endTime?: number): void {
    this.session.resourceManager?.updateAudioLoopRegion(path, startTime, endTime);
  }
  setGlobalVolume(volume: number, muted: boolean): void {
    this.globalVolume = Math.max(0, Math.min(1, volume));
    this.globalMuted = muted;
    this.session.resourceManager?.setGlobalAudioState(this.globalVolume, this.globalMuted);
  }
  controlVideo(path: string, action: "play" | "pause" | "mute" | "unmute" | "reset"): void {
    this.session.resourceManager?.controlVideo(path, action);
  }
  getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    return this.session.resourceManager?.getVideoState(path) ?? null;
  }
  controlAudio(path: string, action: "play" | "pause" | "mute" | "unmute" | "reset"): void {
    this.session.resourceManager?.controlAudio(path, action);
  }
  getAudioState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    return this.session.resourceManager?.getAudioState(path) ?? null;
  }
  seekAudio(path: string, time: number): void {
    this.session.resourceManager?.seekAudio(path, time);
  }
  getAudioFFTData(type: string, path?: string): Uint8Array | null {
    return audioPreviewData(this.session.resourceManager, type, path);
  }

  controlAudioInput(action: "start" | "stop", deviceId?: string): Promise<string | undefined> {
    return controlAudioInput(this.session.resourceManager, action, deviceId);
  }
  controlSystemAudio(action: "start" | "stop", deviceId?: string): Promise<string | undefined> {
    return controlSystemAudio(this.session.resourceManager, action, deviceId);
  }
  controlScreen(action: "start" | "stop"): Promise<string | undefined> {
    return this.session.resourceManager?.controlScreen(action) ?? Promise.resolve("Shader is not ready. Try again after it loads.");
  }
  getLiveInputPreview(type: LiveInputType): LiveInputPreview | null {
    return livePreviewData(this.session.resourceManager, type);
  }
  // ---- Custom uniforms ----

  getMouse(): [number, number, number, number] {
    const mouse = this.mouseManager.getMouse();
    return [mouse[0] ?? 0, mouse[1] ?? 0, mouse[2] ?? 0, mouse[3] ?? 0];
  }

  getChannelTimes(): number[] {
    const imagePass = this.session.passGraph.find((pass) => pass.name === "Image");
    if (!imagePass) {
      return [0, 0, 0, 0];
    }
    return this.channels.getChannelUniforms(imagePass).channelTime;
  }

  getAudioSampleRate(): number {
    return this.session.resourceManager?.getAudioSampleRate?.() || 44100;
  }

  getCustomUniformInfo(): { name: string; type: string }[] {
    return this.session.visibleCustomUniformManager().getUniformInfo();
  }
  getCustomUniformDeclarations(): string {
    return this.session.visibleCustomUniformManager().getDeclarations();
  }
  getCurrentCustomUniforms(): CaptureCustomUniform[] {
    return this.session.visibleCustomUniformManager().getCurrentValues();
  }

  setCustomUniformValues(values: CustomUniform[]): void {
    return this.session.setCustomUniformValues(values);
  }

  updateCustomUniformValues(changed: CustomUniform[]): void {
    return this.session.updateCustomUniformValues(changed);
  }

}
