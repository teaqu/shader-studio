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
import { packShaderToyUniforms } from "./uniforms";
import { SLANG_ENTRY_VERTEX, SLANG_ENTRY_FRAGMENT, SHADERTOY_UNIFORM_SIZE } from "./SlangPrelude";

export interface SlangAssetUrls {
  scriptUrl: string;
  wasmUrl: string;
}

/**
 * WebGPU/Slang counterpart to the WebGL RenderingEngine. M1 scope: a single
 * image pass driven by the ShaderToy-style Slang convention (iTime, iResolution,
 * iMouse, iFrame). Buffers, textures, capture and debugging are out of scope and
 * their interface methods no-op or throw a clear "not supported" error.
 */
export class WebGPURenderingEngine implements RenderingEngine {
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private ready: Promise<void> | null = null;
  private initError: string | null = null;

  private compiler: SlangCompiler | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

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

      const slang = await loadSlangModule(this.slangAssets.scriptUrl, this.slangAssets.wasmUrl);
      this.compiler = new SlangCompiler(slang);
    } catch (e) {
      this.initError = e instanceof Error ? e.message : String(e);
    }
  }

  async compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    _path: string,
    _buffers: Record<string, string> = {},
  ): Promise<CompilationResult | undefined> {
    this.currentConfig = config;
    if (this.ready) await this.ready;

    if (this.initError || !this.device || !this.compiler) {
      return { success: false, errors: [`WebGPU init failed: ${this.initError ?? "device unavailable"}`] };
    }

    const compiled = this.compiler.compileImagePass(code);
    if (!compiled.success) {
      return { success: false, errors: compiled.errors };
    }

    try {
      this.buildPipeline(compiled.wgsl);
    } catch (e) {
      return { success: false, errors: [e instanceof Error ? e.message : String(e)] };
    }

    // Surface WGSL compile diagnostics rather than silently rendering black.
    const wgslErrors = await this.collectShaderErrors();
    if (wgslErrors.length > 0) {
      return { success: false, errors: wgslErrors };
    }

    return { success: true };
  }

  private shaderModule: GPUShaderModule | null = null;

  private buildPipeline(wgsl: string): void {
    const device = this.device!;
    const module = device.createShaderModule({ code: wgsl });
    this.shaderModule = module;

    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: SLANG_ENTRY_VERTEX },
      fragment: { module, entryPoint: SLANG_ENTRY_FRAGMENT, targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });

    this.uniformBuffer = device.createBuffer({
      size: SHADERTOY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  private async collectShaderErrors(): Promise<string[]> {
    if (!this.shaderModule?.getCompilationInfo) return [];
    const info = await this.shaderModule.getCompilationInfo();
    return info.messages
      .filter((m) => m.type === "error")
      .map((m) => `WGSL L${m.lineNum}:${m.linePos} ${m.message}`);
  }

  render(time: number = performance.now()): void {
    if (!this.device || !this.context || !this.pipeline || !this.bindGroup || !this.uniformBuffer) {
      return;
    }
    const canvas = this.canvas!;

    this.timeManager.updateFrame(time);
    this.fps.updateFrame(time);

    const shaderTime = this.timeManager.getCurrentTime(time);
    const data = packShaderToyUniforms({
      width: canvas.width,
      height: canvas.height,
      time: shaderTime,
      timeDelta: this.timeManager.getDeltaTime(),
      frameRate: this.fps.getRawFPS(),
      frame: this.timeManager.getFrame(),
      mouse: this.mouseManager.getMouse(),
    });
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    this.timeManager.incrementFrame();
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
    this.stopRenderLoop();
    this.device?.destroy?.();
    this.device = null;
  }

  // ---- Not yet supported in the Slang/WebGPU path (M1) ----

  getPasses(): unknown[] {
    return [];
  }

  flagForceCleanupOnNextApply(): void {
    // Single-pass M1 has no persistent buffers to clear.
  }

  async updateBufferAndRecompile(): Promise<CompilationResult | undefined> {
    return { success: false, errors: ["Buffers are not supported for Slang shaders yet"] };
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
