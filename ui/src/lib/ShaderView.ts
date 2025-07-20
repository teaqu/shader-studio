import { piRenderer } from "../../vendor/pilibs/src/piRenderer";
import { ShaderCompiler } from "./rendering/ShaderCompiler";
import { ResourceManager } from "./rendering/ResourceManager";
import { BufferManager } from "./rendering/BufferManager";
import { TimeManager } from "./input/TimeManager";
import { KeyboardManager } from "./input/KeyboardManager";
import { MouseManager } from "./input/MouseManager";
import { ShaderPipeline } from "./rendering/ShaderPipeline";
import { ShaderMessageHandler } from "./communication/ShaderMessageHandler";
import { PassRenderer } from "./rendering/PassRenderer";
import { FrameRenderer } from "./rendering/FrameRenderer";
import type { PiRenderer } from "./types/piRenderer";

export class ShaderView {
  private vscode: any;
  private glCanvas: HTMLCanvasElement | null = null;
  private renderer!: PiRenderer;
  
  private shaderCompiler!: ShaderCompiler;
  private resourceManager!: ResourceManager;
  private bufferManager!: BufferManager;
  private timeManager!: TimeManager;
  private keyboardManager!: KeyboardManager;
  private mouseManager!: MouseManager;
  private shaderPipeline!: ShaderPipeline;
  private shaderMessageHandler!: ShaderMessageHandler;
  private passRenderer!: PassRenderer;
  private renderLoopManager!: FrameRenderer;

  constructor(vscode: any) {
    this.vscode = vscode;
  }

  async initialize(glCanvas: HTMLCanvasElement): Promise<boolean> {
    this.glCanvas = glCanvas;
    
    const gl = glCanvas.getContext("webgl2");
    if (!gl) {
      this.vscode.postMessage({
        type: "error",
        payload: ["❌ WebGL2 not supported"],
      });
      return false;
    }

    try {
      this.renderer = piRenderer();
      const success = this.renderer.Initialize(gl);
      if (!success) {
        this.vscode.postMessage({
          type: "error",
          payload: ["❌ piRenderer could not initialize"],
        });
        return false;
      }

      this.shaderCompiler = new ShaderCompiler(this.renderer);
      this.resourceManager = new ResourceManager(this.renderer);
      this.bufferManager = new BufferManager(this.renderer);
      this.timeManager = new TimeManager();
      this.keyboardManager = new KeyboardManager();
      this.mouseManager = new MouseManager();
      
      this.shaderPipeline = new ShaderPipeline(
        glCanvas,
        this.shaderCompiler,
        this.resourceManager,
        this.renderer,
        this.bufferManager,
      );
      
      this.passRenderer = new PassRenderer(
        glCanvas,
        this.resourceManager,
        this.bufferManager,
        this.renderer,
        this.keyboardManager,
      );
      
      this.renderLoopManager = new FrameRenderer(
        this.timeManager,
        this.keyboardManager,
        this.mouseManager,
        this.shaderPipeline,
        this.bufferManager,
        this.passRenderer,
        glCanvas,
      );
      
      this.shaderMessageHandler = new ShaderMessageHandler(
        this.shaderPipeline,
        this.timeManager,
        this.renderLoopManager,
        this.vscode,
      );

      this.vscode.postMessage({
        type: "debug",
        payload: ["Svelte with piLibs initialized"],
      });

      return true;
    } catch (err) {
      this.vscode.postMessage({
        type: "error",
        payload: ["❌ Renderer initialization failed:", err],
      });
      return false;
    }
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
    if (imagePass && this.renderLoopManager.isRunning()) {
      this.renderLoopManager.renderSinglePass(imagePass);
    }
  }

  async handleShaderMessage(
    event: MessageEvent,
    onLockChange: (locked: boolean) => void,
  ): Promise<{ running: boolean }> {
    return await this.shaderMessageHandler.handleShaderMessage(
      event,
      onLockChange,
    );
  }

  handleReset(onComplete?: () => void): void {
    this.shaderMessageHandler.reset(() => {
      if (onComplete) {
        onComplete();
      }
    });
  }

  handleTogglePause(): void {
    this.timeManager.togglePause();
  }

  handleToggleLock(): void {
    this.vscode.postMessage({ type: "toggleLock" });
  }

  stopRenderLoop(): void {
    this.renderLoopManager.stopRenderLoop();
  }

  getTimeManager(): TimeManager {
    return this.timeManager;
  }

  getKeyboardManager(): KeyboardManager {
    return this.keyboardManager;
  }

  getMouseManager(): MouseManager {
    return this.mouseManager;
  }

  getCurrentFPS(): number {
    return this.renderLoopManager.getCurrentFPS();
  }

  getLastShaderEvent(): MessageEvent | null {
    return this.shaderMessageHandler.getLastEvent();
  }

  dispose(): void {
    // Clean up resources
    if (this.bufferManager) {
      this.bufferManager.dispose();
    }
    if (this.renderLoopManager) {
      this.renderLoopManager.stopRenderLoop();
    }
  }
}
