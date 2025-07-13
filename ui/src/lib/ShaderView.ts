import { RenderManager } from "./rendering/RenderManager";
import { ShaderCompiler } from "./rendering/ShaderCompiler";
import { ResourceManager } from "./rendering/ResourceManager";
import { TimeManager } from "./input/TimeManager";
import { InputManager } from "./input/InputManager";
import { ShaderManager } from "./rendering/ShaderManager";
import { RenderLoop } from "./rendering/RenderLoop";

export class ShaderView {
  private vscode: any;
  private glCanvas: HTMLCanvasElement | null = null;
  
  // Manager instances
  private renderManager: RenderManager | null = null;
  private shaderCompiler: ShaderCompiler | null = null;
  private resourceManager: ResourceManager | null = null;
  private timeManager: TimeManager | null = null;
  private inputManager: InputManager | null = null;
  private shaderManager: ShaderManager | null = null;
  private renderLoopManager: RenderLoop | null = null;

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
      this.renderManager = new RenderManager();
      const success = await this.renderManager.initialize(gl, glCanvas);
      if (!success) {
        this.vscode.postMessage({
          type: "error",
          payload: ["❌ piRenderer could not initialize"],
        });
        return false;
      }

      this.shaderCompiler = new ShaderCompiler();
      this.resourceManager = new ResourceManager();
      this.resourceManager.setRenderer(this.renderManager.getRenderer());
      this.timeManager = new TimeManager();
      this.inputManager = new InputManager();
      this.shaderManager = new ShaderManager(
        this.renderManager,
        this.shaderCompiler,
        this.resourceManager,
        this.timeManager,
        this.vscode,
      );
      this.renderLoopManager = new RenderLoop(
        this.timeManager,
        this.inputManager,
        this.renderManager,
        this.shaderManager,
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
    if (!this.renderManager || !this.shaderManager || !this.renderLoopManager || 
        !this.timeManager || !this.inputManager || !this.glCanvas || !this.resourceManager) {
      return;
    }

    this.renderManager.updateCanvasSize(width, height);
    const newBuffers = this.resourceManager.resizePassBuffers(
      this.shaderManager.getPasses(),
      Math.round(width),
      Math.round(height),
    );
    this.shaderManager.setPassBuffers(newBuffers);

    // Redraw the final image pass to prevent a black screen flicker.
    const imagePass = this.shaderManager.getPasses().find((p) =>
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
    if (!this.shaderManager || !this.renderLoopManager) {
      return { running: false };
    }

    const result = await this.shaderManager.handleShaderMessage(
      event,
      onLockChange,
    );

    if (result.running && !this.renderLoopManager.isRunning()) {
      this.renderLoopManager.startRenderLoop();
    }

    return result;
  }

  handleReset(onComplete?: () => void): void {
    if (!this.shaderManager) {
      return;
    }

    this.shaderManager.reset(() => {
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
  getRenderManager(): RenderManager | null {
    return this.renderManager;
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

  getShaderManager(): ShaderManager | null {
    return this.shaderManager;
  }

  getRenderLoop(): RenderLoop | null {
    return this.renderLoopManager;
  }

  getCurrentFPS(): number {
    return this.renderLoopManager?.getCurrentFPS() || 0;
  }

  getLastShaderEvent(): MessageEvent | null {
    return this.shaderManager?.getLastEvent() || null;
  }
}
