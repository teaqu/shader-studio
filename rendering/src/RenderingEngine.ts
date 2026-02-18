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
import { ConfigValidator } from "./util/ConfigValidator";
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
  private currentConfig: ShaderConfig | null = null;

  initialize(glCanvas: HTMLCanvasElement, preserveDrawingBuffer: boolean = false) {
    this.glCanvas = glCanvas;

    const gl = glCanvas.getContext("webgl2", { preserveDrawingBuffer });
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
    // Save the config for later use
    this.currentConfig = config;

    // Validate config before processing
    if (config) {
      const validation = ConfigValidator.validateConfig(config);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Invalid shader configuration: ${validation.errors.join(', ')}`,
        };
      }
    }

    const result: Promise<CompilationResult> = this.shaderPipeline.compileShaderPipeline(
      code,
      config,
      path,
      buffers,
    );

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
        error: `Buffer '${bufferName}' not found in current shader`,
      };
    }

    // Get current shader code
    const imagePass = passes.find(pass => pass.name === "Image");
    if (!imagePass) {
      return {
        success: false,
        error: "No Image pass found in current shader",
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
    
    // Handle videos based on new pause state
    if (wasPaused) {
      // Was paused, now resuming - resume videos
      this.resourceManager.resumeAllVideos();
    } else {
      // Was playing, now pausing - pause videos
      this.resourceManager.pauseAllVideos();
    }
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

  public cleanup(): void {
    this.shaderPipeline.cleanup();
  }

  public getTimeManager(): TimeManager {
    return this.timeManager;
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
