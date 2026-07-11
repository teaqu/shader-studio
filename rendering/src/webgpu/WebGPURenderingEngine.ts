/// <reference types="@webgpu/types" />
import type { ShaderConfig } from "@shader-studio/types";
import type { CompilationResult, PassUniforms } from "../models";
import type { RenderingEngine } from "../types/RenderingEngine";
import type {
  VariableCapturer,
  CaptureUniforms,
  CaptureCompileContext,
  CaptureCustomUniform,
} from "../capture/VariableCapturer";
import { TimeManager } from "../util/TimeManager";
import { MouseManager } from "../input/MouseManager";
import { FPSCalculator } from "../util/FPSCalculator";
import { SlangCompiler } from "./SlangCompiler";
import { loadSlangModule } from "./SlangModuleLoader";
import { MainThreadSlangCompiler, WorkerSlangCompiler, type AsyncSlangCompiler } from "./AsyncSlangCompiler";
import { packShaderToyUniforms } from "./uniforms";
import { buildSlangPassGraph, resolvePassResolution, type RenderPassNode } from "./SlangPassGraph";
import { SlangPassPipeline } from "./SlangPassPipeline";

export interface SlangAssetUrls {
  scriptUrl: string;
  wasmUrl: string;
  /** URL of the compiled slangCompileWorker chunk; absent → main-thread compile. */
  workerUrl?: string;
  /** Emit Slang timing diagnostics to the webview console. */
  debugTimings?: boolean;
}

interface WorkerScriptUrl {
  url: string;
  fetchMs: number;
  blobMs: number;
}

interface PassTiming {
  name: string;
  cacheHit: boolean;
  totalMs?: number;
  slangMs?: number;
  pipelineMs?: number;
  errorCount?: number;
}

/**
 * WebGPU/Slang counterpart to the WebGL RenderingEngine. Supports multi-pass
 * rendering driven by the ShaderToy-style Slang convention (iTime,
 * iResolution, iMouse, iFrame): BufferA-D passes render to float ping-pong
 * textures that other passes sample via iChannelN, and the Image pass renders
 * to the canvas. Textures/media inputs, capture and debugging are not yet
 * supported and their interface methods no-op or throw a clear "not
 * supported" error.
 */
export class WebGPURenderingEngine implements RenderingEngine {
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private ready: Promise<void> | null = null;
  private initError: string | null = null;

  private compiler: AsyncSlangCompiler | null = null;

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

  private timeManager = new TimeManager();
  private mouseManager = new MouseManager();
  private fps = new FPSCalculator(60, 10);
  private currentConfig: ShaderConfig | null = null;
  private running = false;
  private rafId: number | null = null;

  constructor(private slangAssets: SlangAssetUrls) {}

  initialize(glCanvas: HTMLCanvasElement, _preserveDrawingBuffer = false): void {
    this.canvas = glCanvas;
    let ctx: GPUCanvasContext | null = null;
    try {
      ctx = glCanvas.getContext("webgpu");
    } catch {
      ctx = null;
    }
    if (!ctx) {
      this.initError = "WebGPU is not available in this runtime (no webgpu context)";
      return;
    }
    this.context = ctx;
    this.mouseManager.setupEventListeners(glCanvas);
    this.ready = this.initDevice();
  }

  private async initDevice(): Promise<void> {
    try {
      if (!navigator.gpu) throw new Error("navigator.gpu is undefined");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("requestAdapter() returned null");
      const device = await adapter.requestDevice();
      this.device = device;
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context!.configure({ device, format: this.format, alphaMode: "opaque" });

      this.compiler = await this.createCompiler();
    } catch (e) {
      this.initError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Prefer a worker-hosted compiler; fall back to main-thread slang-wasm. */
  private async createCompiler(): Promise<AsyncSlangCompiler> {
    const { scriptUrl, wasmUrl, workerUrl } = this.slangAssets;
    const startedAt = this.now();
    if (workerUrl && typeof Worker !== "undefined") {
      try {
        const workerScript = await this.createWorkerScriptUrl(workerUrl);
        const initStartedAt = this.now();
        const compiler = await WorkerSlangCompiler.create(
          () => new Worker(workerScript.url, { type: "module" }),
          scriptUrl,
          wasmUrl,
        );
        this.logSlangPerf("worker setup", {
          mode: "worker",
          workerUrl,
          fetchMs: this.ms(workerScript.fetchMs),
          blobMs: this.ms(workerScript.blobMs),
          initMs: this.ms(this.now() - initStartedAt),
          totalMs: this.ms(this.now() - startedAt),
        });
        return compiler;
      } catch (e) {
        console.warn("[Slang] worker compiler unavailable, compiling on main thread:", e);
      }
    }
    const mainThreadStartedAt = this.now();
    const slang = await loadSlangModule(scriptUrl, wasmUrl);
    this.logSlangPerf("worker setup", {
      mode: "main-thread",
      workerUrl: workerUrl ?? null,
      loadSlangMs: this.ms(this.now() - mainThreadStartedAt),
      totalMs: this.ms(this.now() - startedAt),
    });
    return new MainThreadSlangCompiler(new SlangCompiler(slang));
  }

  private async createWorkerScriptUrl(workerUrl: string): Promise<WorkerScriptUrl> {
    const fetchStartedAt = this.now();
    const response = await fetch(workerUrl);
    if (!response.ok) {
      throw new Error(`Failed to load Slang worker (${response.status})`);
    }
    const source = await response.text();
    const fetchMs = this.now() - fetchStartedAt;
    const blobStartedAt = this.now();
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
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
    const startedAt = this.now();
    let readyMs = 0;
    // Captured synchronously (before any await) so concurrent calls made in
    // the same tick still get distinct, call-order-correct generations.
    const generation = ++this.compileGeneration;
    this.currentConfig = config;
    // Remember the inputs so updateBufferAndRecompile can re-run this compile
    // with a single buffer's content patched.
    this.lastCompile = { code, path, buffers: { ...buffers } };
    if (this.ready) {
      const readyStartedAt = this.now();
      await this.ready;
      readyMs = this.now() - readyStartedAt;
    }

    if (this.initError || !this.device || !this.compiler) {
      return { success: false, errors: [`WebGPU init failed: ${this.initError ?? "device unavailable"}`] };
    }

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
        const slangStartedAt = this.now();
        const compiled = await this.compiler.compile(pass.source, {
          passName: pass.name,
          commonCode: graph.commonCode,
          channels: pass.channels.map((channel) => ({ slot: channel.slot, key: channel.key })),
        });
        const slangMs = this.now() - slangStartedAt;
        if (!compiled.success) {
          errors.push(...compiled.errors.map((error) => `${pass.name}: ${error}`));
          passTimings.push({
            name: pass.name,
            cacheHit: false,
            slangMs: this.ms(slangMs),
            totalMs: this.ms(this.now() - passStartedAt),
            errorCount: compiled.errors.length,
          });
          continue;
        }
        pipeline = new SlangPassPipeline(this.device, this.format, {
          name: pass.name,
          width: pass.width,
          height: pass.height,
          output: pass.output,
          channels: pass.channels.map((channel) => ({ slot: channel.slot, key: channel.key })),
        });
        const pipelineStartedAt = this.now();
        const wgslErrors = await pipeline.rebuild(compiled.wgsl);
        const pipelineMs = this.now() - pipelineStartedAt;
        errors.push(...wgslErrors);
        passTimings.push({
          name: pass.name,
          cacheHit: false,
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
    const cacheHits = details.passTimings.filter((pass) => pass.cacheHit).length;
    this.logSlangPerf("compile", {
      status,
      path: details.path,
      generation: details.generation,
      totalMs: this.ms(this.now() - details.startedAt),
      readyMs: this.ms(details.readyMs),
      graphMs: this.ms(details.graphMs),
      passCount: details.graph.passes.length,
      cacheHits,
      compiledPasses: details.passTimings
        .filter((pass) => !pass.cacheHit)
        .map((pass) => pass.name),
      passes: details.passTimings,
      warningCount: details.graph.warnings.length,
      errorCount: details.errors.length,
    });
  }

  private logSlangPerf(event: string, data: Record<string, unknown>): void {
    if (this.slangAssets.debugTimings) {
      console.info(`[SlangPerf] ${event}`, data);
    }
  }

  private now(): number {
    return performance.now();
  }

  private ms(value: number): number {
    return Number(value.toFixed(2));
  }

  /**
   * A pass's compiled WGSL depends only on its source, the common code, and
   * its channel layout (slot + key). Width/height are texture concerns
   * handled by resize() without recompiling, so they're deliberately excluded
   * from the key.
   */
  private static passCacheKey(pass: RenderPassNode, commonCode: string): string {
    const channels = pass.channels.map((channel) => `${channel.slot}:${channel.key}`).join(",");
    return JSON.stringify([pass.source, commonCode, channels]);
  }

  render(time: number = performance.now()): void {
    if (!this.device || !this.context || this.passGraph.length === 0) {
      return;
    }

    this.timeManager.updateFrame(time);
    this.fps.updateFrame(time);

    const encoder = this.device.createCommandEncoder();
    const shaderTime = this.timeManager.getCurrentTime(time);

    for (const pass of this.passGraph) {
      const pipeline = this.passPipelines.get(pass.name);
      if (!pipeline?.getPipeline() || !pipeline.getUniformBuffer()) {
        continue;
      }

      // All-or-nothing: the pass's WGSL was compiled against its full channel
      // list, so if any channel source is unresolvable this frame, binding the
      // survivors positionally would mis-bind them. Skip the pass entirely.
      const channelResources = this.getChannelResources(pass);
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
        time: shaderTime,
        timeDelta: this.timeManager.getDeltaTime(),
        frameRate: this.fps.getRawFPS(),
        frame: this.timeManager.getFrame(),
        mouse: this.mouseManager.getMouse(),
      });
      this.device.queue.writeBuffer(pipeline.getUniformBuffer()!, 0, data);

      const targetView = pass.output === "canvas"
        ? this.context.getCurrentTexture().createView()
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

    this.device.queue.submit([encoder.finish()]);

    for (const pass of this.passGraph) {
      if (pass.output === "texture") {
        this.passPipelines.get(pass.name)?.swap();
      }
    }

    this.timeManager.incrementFrame();
  }

  /**
   * Resolve every channel of a pass to a texture view. Returns null if ANY
   * channel is unresolvable (missing source pipeline or view): the pass's
   * shader was compiled against the full channel list, so a partial bind
   * group would attach surviving channels at the wrong bindings.
   */
  private getChannelResources(
    pass: RenderPassNode,
  ): Array<{ slot: number; textureView: GPUTextureView }> | null {
    const resources: Array<{ slot: number; textureView: GPUTextureView }> = [];
    for (const channel of pass.channels) {
      const source = this.passPipelines.get(channel.source);
      const textureView = channel.readFrom === "previous-frame"
        ? source?.getPreviousOutputView()
        : source?.getCurrentOutputView();
      if (!textureView) {
        return null;
      }
      resources.push({ slot: channel.slot, textureView });
    }
    return resources;
  }

  startRenderLoop(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
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
    if (!this.canvas) return;
    const w = Math.round(width);
    const h = Math.round(height);
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
    if (!this.canvas || this.passGraph.length === 0) return;
    const canvasWidth = Math.max(1, this.canvas.width);
    const canvasHeight = Math.max(1, this.canvas.height);
    for (const pass of this.passGraph) {
      const resolution = resolvePassResolution({
        passName: pass.name,
        passConfig: this.currentConfig?.passes?.[pass.name],
        canvasWidth,
        canvasHeight,
        // Resolution settings were already validated at compile time; a
        // resize cannot introduce new config errors.
        errors: [],
      });
      pass.width = resolution.width;
      pass.height = resolution.height;
      this.passPipelines.get(pass.name)?.resize(resolution.width, resolution.height);
    }
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
  }

  dispose(): void {
    this.disposed = true;
    this.stopRenderLoop();
    this.compiler?.dispose();
    this.compiler = null;
    for (const pipeline of this.passPipelines.values()) {
      pipeline.dispose();
    }
    this.passPipelines.clear();
    this.passKeys.clear();
    this.passGraph = [];
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
    // Buffer feedback state is recreated on recompile; nothing extra to clear.
  }

  getFrameTimeHistory(): number[] {
    return [];
  }

  getFrameTimeCount(): number {
    return 0;
  }

  setFPSLimit(_limit: number): void {
    // Not implemented for M1; render loop runs at rAF cadence.
  }

  readPixel(): { r: number; g: number; b: number; a: number } | null {
    // WebGPU readback is async; the sync inspector contract is M5.
    return null;
  }

  createVariableCapturer(): VariableCapturer {
    throw new Error("Variable capture is not supported for Slang shaders");
  }

  getVariableCaptureCompileContext(): CaptureCompileContext {
    return { commonCode: "" };
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
    // No-op for M1.
  }

  // ---- Audio/video (no resources in M1) ----

  async resumeAudioContext(): Promise<void> {}
  resumeAllAudio(): void {}
  updateAudioLoopRegion(): void {}
  setGlobalVolume(): void {}
  controlVideo(): void {}
  getVideoState(): null {
    return null;
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
