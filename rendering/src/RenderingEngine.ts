import { piRenderer } from "../../vendor/pilibs/src/piRenderer";
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
import { ShaderLocker } from "./util/ShaderLocker";
import type { PiRenderer, RenderingEngine as RenderingEngineInterface } from "./types";
import type { ShaderConfig } from "@shader-studio/types";
import type { CompilationResult } from "./models";

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
  private shaderLocker!: ShaderLocker;

  constructor() {
    this.shaderLocker = new ShaderLocker();
  }

  initialize(glCanvas: HTMLCanvasElement) {
    this.glCanvas = glCanvas;

    const gl = glCanvas.getContext("webgl2");
    if (!gl) {
      throw new Error("WebGL2 not supported");
    }

    this.renderer = piRenderer();
    this.renderer.Initialize(gl);
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
      glCanvas,
      new FPSCalculator(30, 5),
    );

    this.frameRenderer.startRenderLoop();
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
  ): Promise<CompilationResult | undefined> {
    if (!this.shaderLocker.shouldProcessShader(path)) {
      return {
        success: false,
      };
    }

    if (path) {
      this.shaderLocker.updateLockedShader(path);
    }

    return this.shaderPipeline.compileShaderPipeline(
      code,
      config,
      path,
      buffers,
    );
  }

  public isLockedShader(): boolean {
    return this.shaderLocker.getIsLocked();
  }

  public togglePause(): void {
    this.timeManager.togglePause();
  }

  public toggleLock(path: string): void {
    this.shaderLocker.toggleLock(path);
  }

  public stopRenderLoop(): void {
    this.frameRenderer.stopRenderLoop();
  }

  public getCurrentFPS(): number {
    return this.frameRenderer.getCurrentFPS();
  }

  public cleanup(): void {
    this.shaderPipeline.cleanup();
  }

  public getLockedShaderPath(): string | undefined {
    return this.shaderLocker.getLockedShaderPath();
  }

  public getTimeManager(): TimeManager {
    return this.timeManager;
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
