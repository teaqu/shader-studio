import { WebGLRenderer } from "./rendering/WebGLRenderer";
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
  
  // Manager instances
  private webglRenderer: WebGLRenderer | null = null;
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
      this.webglRenderer = new WebGLRenderer();
      const success = await this.webglRenderer.initialize(gl, glCanvas);
      if (!success) {
        this.vscode.postMessage({
          type: "error",
          payload: ["❌ piRenderer could not initialize"],
        });
        return false;
      }

      this.shaderCompiler = new ShaderCompiler();
      this.resourceManager = new ResourceManager();
      this.resourceManager.setRenderer(this.webglRenderer.getRenderer());
      this.resourceManager.setShaderCompiler(this.shaderCompiler);
      this.timeManager = new TimeManager();
      this.inputManager = new InputManager();
      
      this.shaderPipeline = new ShaderPipeline(
        this.webglRenderer,
        this.shaderCompiler,
        this.resourceManager,
      );
      
      this.shaderMessageHandler = new ShaderMessageHandler(
        this.shaderPipeline,
        this.timeManager,
        this.vscode,
      );
      
      this.passRenderer = new PassRenderer(
        this.webglRenderer,
        this.resourceManager,
      );
      
      this.renderLoopManager = new FrameRenderer(
        this.timeManager,
        this.inputManager,
        this.webglRenderer,
        this.shaderPipeline,
        this.passRenderer,
        this.glCanvas,
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
    if (!this.webglRenderer || !this.shaderPipeline || !this.renderLoopManager || 
        !this.timeManager || !this.inputManager || !this.glCanvas || !this.resourceManager) {
      return;
    }

    this.webglRenderer.updateCanvasSize(width, height);
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
  getWebGLRenderer(): WebGLRenderer | null {
    return this.webglRenderer;
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
