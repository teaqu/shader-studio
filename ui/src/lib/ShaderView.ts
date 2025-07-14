import { piRenderer } from "../../vendor/pilibs/src/piRenderer";
import { ShaderCompiler } from "./rendering/ShaderCompiler";
import { ResourceManager } from "./rendering/ResourceManager";
import { TimeManager } from "./input/TimeManager";
import { InputManager } from "./input/InputManager";
import { ShaderPipeline } from "./rendering/ShaderPipeline";
import { ShaderMessageHandler } from "./communication/ShaderMessageHandler";
import { PassRenderer } from "./rendering/PassRenderer";
import { FrameRenderer } from "./rendering/FrameRenderer";

export class ShaderView {
  private vscode: any;
  private glCanvas: HTMLCanvasElement | null = null;
  private renderer: any = null;
  
  // Manager instances
  private shaderCompiler: ShaderCompiler | null = null;
  private resourceManager: ResourceManager | null = null;
  private timeManager: TimeManager | null = null;
  private inputManager: InputManager | null = null;
  private shaderPipeline: ShaderPipeline | null = null;
  private shaderMessageHandler: ShaderMessageHandler | null = null;
  private passRenderer: PassRenderer | null = null;
  private renderLoopManager: FrameRenderer | null = null;

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
      // Initialize renderer
      this.renderer = piRenderer();
      const success = await this.renderer.Initialize(gl);
      if (!success) {
        this.vscode.postMessage({
          type: "error",
          payload: ["❌ piRenderer could not initialize"],
        });
        return false;
      }

      // Initialize canvas manager
      // Canvas is now passed directly to components that need it

      this.shaderCompiler = new ShaderCompiler(this.renderer);
      this.resourceManager = new ResourceManager(this.renderer, this.shaderCompiler);
      this.timeManager = new TimeManager();
      this.inputManager = new InputManager();
      
      this.shaderPipeline = new ShaderPipeline(
        glCanvas,
        this.shaderCompiler,
        this.resourceManager,
        this.renderer,
      );
      
      this.shaderMessageHandler = new ShaderMessageHandler(
        this.shaderPipeline,
        this.timeManager,
        this.vscode,
      );
      
      this.passRenderer = new PassRenderer(
        glCanvas,
        this.resourceManager,
        this.renderer,
      );
      
      this.renderLoopManager = new FrameRenderer(
        this.timeManager,
        this.inputManager,
        this.shaderPipeline,
        this.passRenderer,
        glCanvas,
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

  // Canvas and rendering methods
  handleCanvasResize(width: number, height: number): void {
    if (!this.glCanvas || !this.shaderPipeline || !this.renderLoopManager || 
        !this.timeManager || !this.inputManager || !this.resourceManager) {
      return;
    }

    // Update canvas size inline
    const newWidth = Math.round(width);
    const newHeight = Math.round(height);

    if (this.glCanvas.width !== newWidth || this.glCanvas.height !== newHeight) {
      this.glCanvas.width = newWidth;
      this.glCanvas.height = newHeight;
    }
    const newBuffers = this.resourceManager.resizePassBuffers(
      this.shaderPipeline.getPasses(),
      Math.round(width),
      Math.round(height),
    );
    this.shaderPipeline.setPassBuffers(newBuffers);

    // Redraw the final image pass to prevent a black screen flicker.
    const imagePass = this.shaderPipeline.getPasses().find((p) =>
      p.name === "Image"
    );
    if (imagePass && this.renderLoopManager.isRunning()) {
      this.renderLoopManager.renderSinglePass(imagePass);
    }
  }

  // Shader handling methods
  async handleShaderMessage(
    event: MessageEvent,
    onLockChange: (locked: boolean) => void,
  ): Promise<{ running: boolean }> {
    if (!this.shaderMessageHandler || !this.renderLoopManager) {
      return { running: false };
    }

    const result = await this.shaderMessageHandler.handleShaderMessage(
      event,
      onLockChange,
    );

    if (result.running && !this.renderLoopManager.isRunning()) {
      this.renderLoopManager.startRenderLoop();
    }

    return result;
  }

  handleReset(onComplete?: () => void): void {
    if (!this.shaderMessageHandler) {
      return;
    }

    this.shaderMessageHandler.reset(() => {
      if (onComplete) {
        onComplete();
      }
    });
  }

  // Control methods
  handleTogglePause(): void {
    if (!this.timeManager) {
      return;
    }

    this.timeManager.togglePause();
  }

  handleToggleLock(): void {
    this.vscode.postMessage({ type: "toggleLock" });
  }

  stopRenderLoop(): void {
    if (this.renderLoopManager) {
      this.renderLoopManager.stopRenderLoop();
    }
  }

  // Getter methods for managers (for components that need direct access)
  getCanvas(): HTMLCanvasElement | null {
    return this.glCanvas;
  }

  getRenderer(): any {
    return this.renderer;
  }

  getShaderCompiler(): ShaderCompiler | null {
    return this.shaderCompiler;
  }

  getResourceManager(): ResourceManager | null {
    return this.resourceManager;
  }

  getTimeManager(): TimeManager | null {
    return this.timeManager;
  }

  getInputManager(): InputManager | null {
    return this.inputManager;
  }

  getShaderPipeline(): ShaderPipeline | null {
    return this.shaderPipeline;
  }

  getShaderMessageHandler(): ShaderMessageHandler | null {
    return this.shaderMessageHandler;
  }

  getPassRenderer(): PassRenderer | null {
    return this.passRenderer;
  }

  getFrameRenderer(): FrameRenderer | null {
    return this.renderLoopManager;
  }

  getCurrentFPS(): number {
    return this.renderLoopManager?.getCurrentFPS() || 0;
  }

  getLastShaderEvent(): MessageEvent | null {
    return this.shaderMessageHandler?.getLastEvent() || null;
  }
}
