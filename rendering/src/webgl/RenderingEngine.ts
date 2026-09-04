import { piRenderer } from "../../../vendor/pilibs/src/piRenderer";
import { piCreateGlContext } from "../../../vendor/pilibs/src/piWebUtils";
import { ShaderCompiler } from "./ShaderCompiler";
import { ResourceManager } from "../resources/ResourceManager";
import { WebGLTextureBackend } from "./WebGLTextureBackend";
import { BufferManager } from "./BufferManager";
import { TimeManager } from "../util/TimeManager";
import { KeyboardManager } from "../input/KeyboardManager";
import { MouseManager } from "../input/MouseManager";
import { CameraManager } from "../input/CameraManager";
import { ShaderPipeline } from "./ShaderPipeline";
import { PassRenderer } from "./PassRenderer";
import { FrameRenderer } from "./FrameRenderer";
import { FPSCalculator } from "../util/FPSCalculator";
import { ConfigValidator } from "../util/ConfigValidator";
import type { PiRenderer, RenderingEngine as RenderingEngineInterface } from "../types";
import type { ShaderConfig, StorageBufferSnapshot } from "@shader-studio/types";
import type { ConfigInput } from "@shader-studio/types";
import type { CompilationResult } from "../models";
import { CustomUniformManager } from "./CustomUniformManager";
import { VariableCapturer } from "../capture/VariableCapturer";
import type { CaptureCompileContext, CaptureUniforms } from "../capture/VariableCapturer";
import { assignInputSlots } from "../util/InputSlotAssigner";
import type { ChannelSamplerType } from "./ShaderCompiler";
import type { PiTexture } from "../types/piRenderer";
import { buildBufferPassSizes } from "./BufferPassResolution";
import { WebGLPixelRegionCapturer } from "./WebGLPixelRegionCapturer";
import { WebGLMeshResources } from "./WebGLMeshResources";
import type { PixelRegionResult } from "../types/PixelRegion";
import {
  clampSizeToWebGLRenderLimits,
  getWebGLRenderLimits,
  type WebGLRenderLimits,
} from "./WebGLRenderLimits";

export class RenderingEngine implements RenderingEngineInterface {
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private renderer!: PiRenderer;

  private shaderCompiler!: ShaderCompiler;
  private resourceManager!: ResourceManager<PiTexture>;
  private bufferManager!: BufferManager;
  private timeManager!: TimeManager;
  private keyboardManager!: KeyboardManager;
  private mouseManager!: MouseManager;
  private cameraManager!: CameraManager;
  private shaderPipeline!: ShaderPipeline;
  private passRenderer!: PassRenderer;
  private frameRenderer!: FrameRenderer;
  private customUniformManager!: CustomUniformManager;
  private pendingCustomUniformValues: { name: string; type: string; value: number | number[] | boolean }[] | null = null;
  private currentConfig: ShaderConfig | null = null;
  private compileQueue: Promise<void> = Promise.resolve();
  private renderLimits: WebGLRenderLimits | null = null;
  private holdVideoResumeForResetCompile = false;
  private pixelRegionCapturer: WebGLPixelRegionCapturer | null = null;
  private meshResources: WebGLMeshResources | null = null;

  initialize(glCanvas: HTMLCanvasElement, preserveDrawingBuffer: boolean = false) {
    this.frameRenderer?.setPostImageCallback?.(null);
    this.frameRenderer?.stopRenderLoop?.();
    this.pixelRegionCapturer?.dispose();
    this.pixelRegionCapturer = null;
    this.glCanvas = glCanvas;

    const gl = piCreateGlContext(glCanvas, false, true, preserveDrawingBuffer, false);
    if (!gl) {
      throw new Error("WebGL2 not supported");
    }

    this.gl = gl as WebGL2RenderingContext;
    this.meshResources?.dispose();
    this.meshResources = new WebGLMeshResources(this.gl);
    this.renderLimits = getWebGLRenderLimits(this.gl);
    try {
      const maxTextureUnits = this.gl.getParameter(this.gl.MAX_TEXTURE_IMAGE_UNITS);
      if (typeof maxTextureUnits === "number" && maxTextureUnits > 0) {
        ConfigValidator.setChannelLimit(maxTextureUnits);
      }
    } catch {
      // Non-standard GL context (e.g., test mock) — keep default limit
    }
    this.clampCanvasToRenderLimits();
    this.renderer = piRenderer();
    this.renderer.Initialize(this.gl);
    this.shaderCompiler = new ShaderCompiler(this.renderer, this.gl);
    this.resourceManager = new ResourceManager(new WebGLTextureBackend(this.renderer));
    this.bufferManager = new BufferManager(this.renderer);
    this.timeManager = new TimeManager();
    this.keyboardManager = new KeyboardManager();
    this.mouseManager = new MouseManager();
    this.cameraManager = new CameraManager(this.keyboardManager);

    this.customUniformManager = new CustomUniformManager();

    this.keyboardManager.setupEventListeners();
    this.mouseManager.setupEventListeners(glCanvas);
    this.cameraManager.setupEventListeners(glCanvas);

    this.shaderPipeline = new ShaderPipeline(
      glCanvas,
      this.shaderCompiler,
      this.resourceManager,
      this.renderer,
      this.bufferManager,
      this.timeManager,
      this.renderLimits,
    );

    this.passRenderer = new PassRenderer(
      glCanvas,
      this.resourceManager,
      this.bufferManager,
      this.renderer,
      this.keyboardManager,
      this.meshResources,
    );
    this.passRenderer.attachMeshCamera();

    this.frameRenderer = new FrameRenderer(
      this.timeManager,
      this.keyboardManager,
      this.mouseManager,
      this.cameraManager,
      this.shaderPipeline,
      this.bufferManager,
      this.passRenderer,
      this.resourceManager,
      glCanvas,
      new FPSCalculator(60, 10),
    );
    const pixelRegionCapturer = new WebGLPixelRegionCapturer(this.gl);
    this.pixelRegionCapturer = pixelRegionCapturer;
    this.frameRenderer.setPostImageCallback(() => {
      pixelRegionCapturer.captureAfterRender(glCanvas.width, glCanvas.height);
    });
  }

  public handleCanvasResize(width: number, height: number): void {
    if (!this.glCanvas) {
      return;
    }

    const { width: newWidth, height: newHeight } = this.applyCanvasRenderSize(width, height);

    const bufferPassSizes = buildBufferPassSizes(this.currentConfig, newWidth, newHeight, this.renderLimits);
    if (bufferPassSizes) {
      this.bufferManager.resizeBuffers(newWidth, newHeight, bufferPassSizes);
    } else {
      this.bufferManager.resizeBuffers(newWidth, newHeight);
    }

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
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
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

    return this.enqueueCompilation(() => this.compileShaderPipelineNow(
      code,
      config,
      path,
      buffers,
      customUniformDeclarations,
      customUniformInfo,
    ));
  }

  private enqueueCompilation(
    task: () => Promise<CompilationResult | undefined>,
  ): Promise<CompilationResult | undefined> {
    const queuedTask = this.compileQueue.then(task, task);
    this.compileQueue = queuedTask.then(
      () => undefined,
      () => undefined,
    );
    return queuedTask;
  }

  private async compileShaderPipelineNow(
    code: string,
    config: ShaderConfig | null,
    path: string,
    buffers: Record<string, string>,
    customUniformDeclarations?: string,
    customUniformInfo?: { name: string; type: string }[],
  ): Promise<CompilationResult | undefined> {
    this.clampCanvasToRenderLimits();

    // Load custom uniforms — prefer pre-evaluated declarations from extension host
    if (customUniformDeclarations && customUniformInfo) {
      this.customUniformManager.loadDeclarations(customUniformDeclarations, customUniformInfo);
      // Re-apply any pending values that arrived before/during compilation
      if (this.pendingCustomUniformValues) {
        this.customUniformManager.setValues(this.pendingCustomUniformValues);
      }
      this.shaderPipeline.setCustomUniformManager(this.customUniformManager);
      this.frameRenderer.setCustomUniformManager(this.customUniformManager);
    } else {
      this.customUniformManager.clear();
      this.shaderPipeline.setCustomUniformManager(null);
      this.frameRenderer.setCustomUniformManager(null);
    }

    const result = await this.shaderPipeline.compileShaderPipeline(
      code,
      config,
      path,
      buffers,
    );

    const holdVideosForReset = this.holdVideoResumeForResetCompile;

    if (result.success) {
      try {
        for (const pass of this.shaderPipeline.getPasses()) {
          if (pass.modelPath) {
            await this.meshResources?.loadModel(pass.name, pass.modelPath, pass.modelMesh);
          }
        }
      } catch (error) {
        return { success: false, errors: [error instanceof Error ? error.message : String(error)] };
      }
      const shaderTime = this.timeManager.getCurrentTime(performance.now());
      const paused = this.timeManager.isPaused();
      this.resourceManager.syncAllVideosToTime(shaderTime);
      if (paused || holdVideosForReset) {
        // Newly loaded media is held when the shader is paused, and reset
        // replays hold videos so audio/video can restart together afterwards.
        this.resourceManager.pauseAllVideos();
      } else {
        this.resourceManager.resumeAllVideos();
      }
      // Audio never auto-plays on compilation — it only starts on explicit user
      // action (reset button). Keep it paused regardless of shader pause state.
    }

    return result;
  }

  private clampCanvasToRenderLimits(): void {
    if (!this.glCanvas) {
      return;
    }

    this.applyCanvasRenderSize(this.glCanvas.width, this.glCanvas.height);
  }

  private clampSizeToRenderLimits(width: number, height: number): { width: number; height: number } {
    return clampSizeToWebGLRenderLimits(width, height, this.renderLimits ?? this.getRenderLimitsFromContext());
  }

  private applyCanvasRenderSize(width: number, height: number): { width: number; height: number } {
    if (!this.glCanvas) {
      return this.clampSizeToRenderLimits(width, height);
    }

    const clampedSize = this.clampSizeToRenderLimits(width, height);
    this.glCanvas.width = clampedSize.width;
    this.glCanvas.height = clampedSize.height;

    const drawingBufferSize = this.getDrawingBufferSize();
    if (!drawingBufferSize) {
      return clampedSize;
    }

    if (drawingBufferSize.width !== this.glCanvas.width || drawingBufferSize.height !== this.glCanvas.height) {
      this.glCanvas.width = drawingBufferSize.width;
      this.glCanvas.height = drawingBufferSize.height;
    }

    return drawingBufferSize;
  }

  private getDrawingBufferSize(): { width: number; height: number } | null {
    if (!this.gl) {
      return null;
    }

    const width = this.gl.drawingBufferWidth;
    const height = this.gl.drawingBufferHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    return {
      width: Math.floor(width),
      height: Math.floor(height),
    };
  }

  private getRenderLimitsFromContext(): WebGLRenderLimits | null {
    if (this.renderLimits || !this.gl) {
      return this.renderLimits;
    }

    this.renderLimits = getWebGLRenderLimits(this.gl);
    return this.renderLimits;
  }

  public getCurrentConfig(): ShaderConfig | null {
    return this.currentConfig;
  }

  public async readStorageBuffer(_name: string, _start: number, _count: number): Promise<StorageBufferSnapshot> {
    throw new Error("Storage inspection requires the Slang/WebGPU renderer");
  }

  public async writeStorageBuffer(_name: string, _start: number, _data: ArrayBuffer): Promise<void> {
    throw new Error("Storage inspection requires the Slang/WebGPU renderer");
  }

  public setInputEnabled(enabled: boolean): void {
    this.keyboardManager.setEnabled(enabled);
    this.mouseManager.setEnabled(enabled);
    this.cameraManager.setEnabled(enabled);
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
    this.cameraManager.reset();
    this.holdVideoResumeForResetCompile = true;
  }

  public flagReloadOnNextApply(): void {
    this.shaderPipeline.flagReloadOnNextApply();
  }

  /** Resume audio without clearing user-paused state. Used on reset. */
  public resumeAllAudio(): void {
    this.resourceManager.resumeAllAudio();
  }

  public resumeAllVideos(): void {
    this.holdVideoResumeForResetCompile = false;
    this.resourceManager.resumeAllVideos();
  }

  public releaseMediaResetHold(): void {
    this.holdVideoResumeForResetCompile = false;
  }

  public setGlobalVolume(volume: number, muted: boolean): void {
    this.resourceManager.setGlobalAudioState(volume, muted);
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
      const wasRunning = this.frameRenderer.isRunning();
      this.frameRenderer.setRunning(true);
      this.frameRenderer.render(time);
      this.frameRenderer.setRunning(wasRunning);
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

  public getUniforms(): import("../models").PassUniforms {
    return this.frameRenderer.getUniforms();
  }

  public cleanup(): void {
    try {
      this.pixelRegionCapturer?.cancelPendingCaptures();
    } finally {
      this.shaderPipeline?.cleanup();
    }
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

  public getShaderLanguage(): "glsl" | "slang" {
    return "glsl";
  }

  public createVariableCapturer(): VariableCapturer {
    const gl = this.glCanvas!.getContext('webgl2')!;
    return new VariableCapturer(
      gl,
      this.shaderCompiler,
      this.getVariableCaptureCompileContext(),
      (inputConfig) => this.getVariableCaptureTextureBindings(inputConfig),
    );
  }

  public getVariableCaptureCompileContext(code?: string, passName?: string): CaptureCompileContext {
    const passes = this.shaderPipeline.getPasses();
    const commonPass = passes.find(pass => pass.name === "common");
    const commonPassCode = commonPass?.shaderSrc ?? '';
    // When capturing the common pass itself, avoid injecting common code again
    // into the temporary capture shader or GLSL symbols will be defined twice.
    const isCapturingCommonPass = passName === "common" || !!(code && commonPass && commonPass.shaderSrc === code);

    const targetPass = (passName
      ? passes.find(pass => pass.name === passName && pass.name !== "common")
      : undefined) || (code
      ? passes.find(pass => pass.name !== "common" && pass.shaderSrc === code)
      : undefined) || passes.find(pass => pass.name === "Image") || passes.find(pass => pass.name !== "common");

    if (!targetPass) {
      return { commonCode: isCapturingCommonPass ? '' : commonPassCode };
    }

    const slotAssignments = assignInputSlots(targetPass.inputs || {});
    const channelTypes: ChannelSamplerType[] = ['2D', '2D', '2D', '2D'];

    return {
      commonCode: isCapturingCommonPass ? '' : commonPassCode,
      slotAssignments,
      channelTypes,
    };
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
      cameraPos: u.cameraPos as number[],
      cameraDir: u.cameraDir as number[],
    };
  }

  public renderForCapture(): void {
    this.frameRenderer.renderForCapture();
  }

  private getVariableCaptureTextureBindings(inputConfig: Record<string, ConfigInput>): (PiTexture | null)[] {
    const slotAssignments = assignInputSlots(inputConfig);
    const channelCount = Math.max(4, slotAssignments.length);
    const defaultTexture = this.resourceManager.getDefaultTexture();
    const passBuffers = this.bufferManager.getPassBuffers();
    const textureBindings: (PiTexture | null)[] = new Array(channelCount).fill(defaultTexture);

    for (const { slot, key } of slotAssignments) {
      const input = inputConfig[key];
      if (!input) {
        textureBindings[slot] = defaultTexture;
        continue;
      }

      if (input.type === 'texture' && input.path) {
        const imageCache = this.resourceManager.getImageTextureCache();
        textureBindings[slot] = imageCache[input.resolved_path || input.path] || imageCache[input.path] || defaultTexture;
      } else if (input.type === 'keyboard') {
        this.resourceManager.updateKeyboardTexture(
          this.keyboardManager.getKeyHeld(),
          this.keyboardManager.getKeyPressed(),
          this.keyboardManager.getKeyToggled(),
        );
        textureBindings[slot] = this.resourceManager.getKeyboardTexture() || defaultTexture;
      } else if (input.type === 'buffer') {
        textureBindings[slot] = passBuffers[input.source]?.front?.mTex0 || defaultTexture;
      } else if (input.type === 'video' && input.path) {
        textureBindings[slot] = this.resourceManager.getVideoTexture(input.resolved_path || input.path) || this.resourceManager.getVideoTexture(input.path) || defaultTexture;
      } else if (input.type === 'audio' && input.path) {
        textureBindings[slot] = this.resourceManager.getAudioTexture(input.resolved_path || input.path) || this.resourceManager.getAudioTexture(input.path) || defaultTexture;
      }
    }

    return textureBindings;
  }

  public getCustomUniformInfo(): { name: string; type: string }[] {
    if (!this.customUniformManager?.hasUniforms()) {
      return [];
    }
    return this.customUniformManager.getUniformInfo();
  }

  public getCustomUniformDeclarations(): string {
    return this.customUniformManager?.getDeclarations() || '';
  }

  public getCurrentCustomUniforms(): { name: string; type: string; value: number | number[] | boolean }[] {
    return this.customUniformManager?.getCurrentValues() || [];
  }

  public setCustomUniformValues(values: { name: string; type: string; value: number | number[] | boolean }[]): void {
    // Always store latest values so they can be applied after compilation
    this.pendingCustomUniformValues = values;
    if (this.customUniformManager) {
      this.customUniformManager.setValues(values);
    }
  }

  public updateCustomUniformValues(changed: { name: string; type: string; value: number | number[] | boolean }[]): void {
    if (this.customUniformManager) {
      this.customUniformManager.updateValues(changed);
    }
  }

  public getCanvas(): HTMLCanvasElement | null {
    return this.glCanvas;
  }

  public requestPixelRegion(requestId: number, centerX: number, centerY: number): boolean {
    return this.pixelRegionCapturer?.queue({ requestId, centerX, centerY }) ?? false;
  }

  public collectPixelRegionResults(): PixelRegionResult[] {
    return this.pixelRegionCapturer?.collectResults() ?? [];
  }

  public cancelPixelRegionRequests(): void {
    this.pixelRegionCapturer?.cancelPendingCaptures();
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
    let firstError: unknown;
    let hasError = false;
    const attempt = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    };

    attempt(() => this.frameRenderer?.setPostImageCallback?.(null));
    attempt(() => this.pixelRegionCapturer?.dispose());
    this.pixelRegionCapturer = null;
    attempt(() => this.meshResources?.dispose());
    this.meshResources = null;
    attempt(() => this.passRenderer?.dispose());
    attempt(() => this.bufferManager?.dispose());
    attempt(() => this.frameRenderer?.stopRenderLoop());
    attempt(() => this.cameraManager?.dispose());
    attempt(() => this.mouseManager?.dispose());
    attempt(() => this.keyboardManager?.dispose());
    attempt(() => this.shaderPipeline?.dispose());

    if (hasError) {
      throw firstError;
    }
  }
}
