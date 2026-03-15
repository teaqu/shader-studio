import { piRenderer } from "../../vendor/pilibs/src/piRenderer";
import { piCreateGlContext } from "../../vendor/pilibs/src/piWebUtils";
import { ShaderCompiler } from "./ShaderCompiler";
import { ResourceManager } from "./ResourceManager";
import { BufferManager } from "./BufferManager";
import { TimeManager } from "./util/TimeManager";
import { KeyboardManager } from "./input/KeyboardManager";
import { MouseManager } from "./input/MouseManager";
import { ShaderPipeline } from "./ShaderPipeline";
import { PassRenderer } from "./PassRenderer";
import { FrameRenderer } from "./FrameRenderer";
import { FPSCalculator } from "./util/FPSCalculator";
import { ConfigValidator } from "./util/ConfigValidator";
import type { PiRenderer, RenderingEngine as RenderingEngineInterface } from "./types";
import type { ShaderConfig } from "@shader-studio/types";
import type { CompilationResult } from "./models";
import { VariableCapturer } from "./capture/VariableCapturer";
import type { CaptureUniforms } from "./capture/VariableCapturer";

export class RenderingEngine implements RenderingEngineInterface {
  private glCanvas: HTMLCanvasElement | null = null;
  private renderer!: PiRenderer;

  private shaderCompiler!: ShaderCompiler;
  private resourceManager!: ResourceManager;
  private bufferManager!: BufferManager;
  private timeManager!: TimeManager;
  private keyboardManager!: KeyboardManager;
  private mouseManager!: MouseManager;
  private shaderPipeline!: ShaderPipeline;
  private passRenderer!: PassRenderer;
  private frameRenderer!: FrameRenderer;
  private currentConfig: ShaderConfig | null = null;

  initialize(glCanvas: HTMLCanvasElement, preserveDrawingBuffer: boolean = false) {
    this.glCanvas = glCanvas;

    const gl = piCreateGlContext(glCanvas, false, false, preserveDrawingBuffer, false);
    if (!gl) {
      throw new Error("WebGL2 not supported");
    }

    this.renderer = piRenderer();
    this.renderer.Initialize(gl as WebGL2RenderingContext);
    this.shaderCompiler = new ShaderCompiler(this.renderer);
    this.resourceManager = new ResourceManager(this.renderer);
    this.bufferManager = new BufferManager(this.renderer);
    this.timeManager = new TimeManager();
    this.keyboardManager = new KeyboardManager();
    this.mouseManager = new MouseManager();

    this.keyboardManager.setupEventListeners();
    this.mouseManager.setupEventListeners(glCanvas);

    this.shaderPipeline = new ShaderPipeline(
      glCanvas,
      this.shaderCompiler,
      this.resourceManager,
      this.renderer,
      this.bufferManager,
      this.timeManager
    );

    this.passRenderer = new PassRenderer(
      glCanvas,
      this.resourceManager,
      this.bufferManager,
      this.renderer,
      this.keyboardManager,
    );

    this.frameRenderer = new FrameRenderer(
      this.timeManager,
      this.keyboardManager,
      this.mouseManager,
      this.shaderPipeline,
      this.bufferManager,
      this.passRenderer,
      this.resourceManager,
      glCanvas,
      new FPSCalculator(60, 10),
    );
  }

  public handleCanvasResize(width: number, height: number): void {
    if (!this.glCanvas) {
      return;
    }

    const newWidth = Math.round(width);
    const newHeight = Math.round(height);

    if (this.glCanvas.width !== newWidth || this.glCanvas.height !== newHeight) {
      this.glCanvas.width = newWidth;
      this.glCanvas.height = newHeight;
    }

    this.bufferManager.resizeBuffers(
      newWidth,
      newHeight,
    );

    // Redraw the final image pass to prevent a black screen flicker.
    const imagePass = this.shaderPipeline.getPass("Image");
    if (imagePass && this.frameRenderer.isRunning()) {
      this.frameRenderer.renderSinglePass(imagePass);
    }
  }

  public async compileShaderPipeline(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string> = {},
    audioOptions?: { muted?: boolean; volume?: number },
  ): Promise<CompilationResult | undefined> {
    // Save the config for later use
    this.currentConfig = config;

    // Validate config before processing
    if (config) {
      const validation = ConfigValidator.validateConfig(config);
      if (!validation.isValid) {
        return {
          success: false,
          errors: [`Invalid shader configuration: ${validation.errors.join(', ')}`],
        };
      }
    }

    const result = await this.shaderPipeline.compileShaderPipeline(
      code,
      config,
      path,
      buffers,
      audioOptions,
    );

    if (result.success) {
      const shaderTime = this.timeManager.getCurrentTime(performance.now());
      this.resourceManager.syncAllVideosToTime(shaderTime);
      if (this.timeManager.isPaused()) {
        // Newly loaded media autoplay — force pause if shader is paused
        this.resourceManager.pauseAllVideos();
      } else {
        this.resourceManager.resumeAllVideos();
      }
      // Audio never auto-plays on compilation — it only starts on explicit user
      // action (reset button). Keep it paused regardless of shader pause state.
    } else {
      this.resourceManager.pauseAllVideos();
      this.resourceManager.pauseAllAudio();
    }

    return result;
  }

  public getCurrentConfig(): ShaderConfig | null {
    return this.currentConfig;
  }

  public async updateBufferAndRecompile(bufferName: string, bufferContent: string): Promise<CompilationResult | undefined> {
    // Get current passes to find the buffer
    const passes = this.shaderPipeline.getPasses();
    const bufferPass = passes.find(pass => pass.name === bufferName && pass.name !== "Image");
    
    if (!bufferPass) {
      return {
        success: false,
        errors: [`Buffer '${bufferName}' not found in current shader`],
      };
    }

    // Get current shader code
    const imagePass = passes.find(pass => pass.name === "Image");
    if (!imagePass) {
      return {
        success: false,
        errors: ["No Image pass found in current shader"],
      };
    }

    // Create updated buffers with just the specific buffer
    const updatedBuffers: Record<string, string> = {};
    for (const pass of passes) {
      if (pass.name !== "Image" && pass.shaderSrc) {
        updatedBuffers[pass.name] = pass.name === bufferName ? bufferContent : pass.shaderSrc;
      }
    }

    // Use the saved config instead of reconstructing it
    const config = this.currentConfig;

    // Recompile with updated buffer
    return this.compileShaderPipeline(
      imagePass.shaderSrc,
      config,
      this.shaderPipeline.getShaderPath(),
      updatedBuffers
    );
  }

  public getPasses(): any[] {
    return this.shaderPipeline.getPasses();
  }

  public togglePause(): void {
    const wasPaused = this.timeManager.isPaused();

    // Toggle time manager
    this.timeManager.togglePause();

    // Sync media time to shader time
    const shaderTime = this.timeManager.getCurrentTime(performance.now());
    this.resourceManager.syncAllVideosToTime(shaderTime);
    this.resourceManager.syncAllAudioToTime(shaderTime);

    // Handle media based on new pause state
    if (wasPaused) {
      this.resourceManager.resumeAllVideos();
      this.resourceManager.resumeAllAudio();
    } else {
      this.resourceManager.pauseAllVideos();
      this.resourceManager.pauseAllAudio();
    }
  }

  public async resumeAudioContext(): Promise<void> {
    return this.resourceManager.resumeAudioContext();
  }

  public resetTime(): void {
    this.shaderPipeline.resetTime();
  }

  /** Force-resume all audio, clearing user-paused state. Used on reset. */
  public resumeAllAudio(): void {
    this.resourceManager.forceResumeAllAudio();
  }

  public setGlobalVolume(volume: number, muted: boolean): void {
    if (muted) {
      this.resourceManager.muteAllAudio();
    } else {
      this.resourceManager.unmuteAllAudio(volume);
    }
  }

  public controlVideo(path: string, action: 'play' | 'pause' | 'mute' | 'unmute' | 'reset'): void {
    this.resourceManager.controlVideo(path, action);
  }

  public getVideoState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    return this.resourceManager.getVideoState(path);
  }

  public controlAudio(path: string, action: 'play' | 'pause' | 'mute' | 'unmute' | 'reset'): void {
    this.resourceManager.controlAudio(path, action);
  }

  public getAudioState(path: string): { paused: boolean; muted: boolean; currentTime: number; duration: number } | null {
    return this.resourceManager.getAudioState(path);
  }

  public seekAudio(path: string, time: number): void {
    this.resourceManager.seekAudio(path, time);
  }

  public updateAudioLoopRegion(path: string, startTime?: number, endTime?: number): void {
    this.resourceManager.updateAudioLoopRegion(path, startTime, endTime);
  }

  public startRenderLoop(): void {
    this.frameRenderer.startRenderLoop();
  }

  public stopRenderLoop(): void {
    this.frameRenderer.stopRenderLoop();
  }

  public render(time: number = performance.now()): void {
    if (this.frameRenderer) {
      this.frameRenderer.setRunning(true);
      this.frameRenderer.render(time);
      this.frameRenderer.setRunning(false);
    }
  }

  public getCurrentFPS(): number {
    return this.frameRenderer.getCurrentFPS();
  }

  public setFPSLimit(limit: number): void {
    this.frameRenderer.setFPSLimit(limit);
  }

  public getFrameTimeHistory(): number[] {
    return this.frameRenderer.getFrameTimeHistory();
  }

  public getFrameTimeCount(): number {
    return this.frameRenderer.getFrameTimeCount();
  }

  public getUniforms(): import("./models").PassUniforms {
    return this.frameRenderer.getUniforms();
  }

  public cleanup(): void {
    this.shaderPipeline.cleanup();
  }

  public getAudioFFTData(type: string, path?: string): Uint8Array | null {
    if (type === 'audio' && path) {
      return this.resourceManager.getAudioFFTData(path);
    }
    return null;
  }

  public getTimeManager(): TimeManager {
    return this.timeManager;
  }

  public createVariableCapturer(): VariableCapturer {
    const gl = this.glCanvas!.getContext('webgl2')!;
    return new VariableCapturer(gl, this.shaderCompiler);
  }

  public getCaptureUniforms(): CaptureUniforms {
    const u = this.frameRenderer.getUniforms();
    return {
      time: u.time,
      timeDelta: u.timeDelta,
      frameRate: u.frameRate,
      frame: u.frame,
      res: u.res as number[],
      mouse: u.mouse as number[],
      date: u.date as number[],
    };
  }

  public renderForCapture(): void {
    this.frameRenderer.renderForCapture();
  }

  public getCanvas(): HTMLCanvasElement | null {
    return this.glCanvas;
  }

  public readPixel(x: number, y: number): { r: number; g: number; b: number; a: number } | null {
    if (!this.glCanvas) {
      return null;
    }

    const gl = this.glCanvas.getContext("webgl2");
    if (!gl) {
      return null;
    }

    // WebGL coordinates are from bottom-left, so we need to flip Y
    const glY = this.glCanvas.height - y - 1;

    // Read a single pixel
    const pixels = new Uint8Array(4);
    gl.readPixels(x, glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    return {
      r: pixels[0],
      g: pixels[1],
      b: pixels[2],
      a: pixels[3],
    };
  }

  dispose(): void {
    // Clean up resources
    if (this.bufferManager) {
      this.bufferManager.dispose();
    }
    if (this.frameRenderer) {
      this.frameRenderer.stopRenderLoop();
    }
  }
}
