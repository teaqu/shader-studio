import { RenderManager } from "../rendering/RenderManager";
import { ShaderCompiler } from "../rendering/ShaderCompiler";
import { ResourceManager } from "../rendering/ResourceManager";
import { TimeManager } from "../input/TimeManager";
import { InputManager } from "../input/InputManager";
import { ShaderManager } from "../rendering/ShaderManager";
import { RenderLoopManager } from "../rendering/RenderLoopManager";

export class ShaderView {
  private vscode: any;
  private fpsCounter: any;
  private glCanvas: HTMLCanvasElement | null = null;
  private renderLoopActive = false;
  
  // Manager instances
  private renderManager: RenderManager | null = null;
  private shaderCompiler: ShaderCompiler | null = null;
  private resourceManager: ResourceManager | null = null;
  private timeManager: TimeManager | null = null;
  private inputManager: InputManager | null = null;
  private shaderManager: ShaderManager | null = null;
  private renderLoopManager: RenderLoopManager | null = null;

  constructor(vscode: any, fpsCounter: any) {
    this.vscode = vscode;
    this.fpsCounter = fpsCounter;
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
      // Initialize managers
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
      this.renderLoopManager = new RenderLoopManager(this.fpsCounter);

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
        !this.timeManager || !this.inputManager || !this.glCanvas) {
      return;
    }

    this.renderManager.updateCanvasSize(width, height);
    const newBuffers = this.renderManager.resizePassBuffers(
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
      const uniforms = this.timeManager.getUniforms(
        this.glCanvas.width,
        this.glCanvas.height,
        this.inputManager.getMouse(),
      );
      const shader = this.shaderManager.getPassShaders()[imagePass.name];
      const textureBindings = this.shaderManager.getTextureBindings(
        imagePass,
        this.inputManager,
      );
      this.renderManager.drawPass(
        imagePass,
        null,
        uniforms,
        shader,
        textureBindings,
      );
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

    if (result.running && !this.renderLoopActive) {
      this.renderLoopManager.setRunning(true);
      this.startRenderLoop();
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

  // Render loop management
  private startRenderLoop(): void {
    this.renderLoopActive = true;

    const render = (time: number) => {
      if (!this.renderLoopActive || !this.glCanvas) return;

      if (!this.renderLoopManager || !this.shaderManager || !this.timeManager || 
          !this.inputManager || !this.renderManager) {
        this.renderLoopActive = false;
        return;
      }

      this.renderLoopManager.render(
        time,
        this.timeManager,
        this.inputManager,
        this.renderManager,
        this.shaderManager,
        this.glCanvas,
      );

      if (this.renderLoopManager.isRunning()) {
        requestAnimationFrame(render);
      } else {
        this.renderLoopActive = false;
      }
    };

    requestAnimationFrame(render);
  }

  stopRenderLoop(): void {
    this.renderLoopActive = false;
    if (this.renderLoopManager) {
      this.renderLoopManager.setRunning(false);
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

  getRenderLoopManager(): RenderLoopManager | null {
    return this.renderLoopManager;
  }

  // Utility methods
  getCurrentFPS(): number {
    return this.renderLoopManager?.getCurrentFPS() || 0;
  }

  getLastShaderEvent(): MessageEvent | null {
    return this.shaderManager?.getLastEvent() || null;
  }

  isInitialized(): boolean {
    return !!(
      this.renderManager &&
      this.shaderCompiler &&
      this.resourceManager &&
      this.timeManager &&
      this.inputManager &&
      this.shaderManager &&
      this.renderLoopManager
    );
  }
}
