import { RenderManager } from "./RenderManager";
import { ShaderCompiler } from "./ShaderCompiler";
import { ResourceManager } from "./ResourceManager";
import { TimeManager } from "./TimeManager";
import { InputManager } from "./InputManager";
import { ShaderManager } from "./ShaderManager";
import { RenderLoopManager } from "./RenderLoopManager";

export interface ManagerInstances {
  renderManager: RenderManager;
  shaderCompiler: ShaderCompiler;
  resourceManager: ResourceManager;
  timeManager: TimeManager;
  inputManager: InputManager;
  shaderManager: ShaderManager;
  renderLoopManager: RenderLoopManager;
}

export class AppInitializer {
  private vscode: any;
  private fpsCounter: any;

  constructor(vscode: any, fpsCounter: any) {
    this.vscode = vscode;
    this.fpsCounter = fpsCounter;
  }

  async initializeManagers(
    glCanvas: HTMLCanvasElement,
  ): Promise<ManagerInstances | null> {
    const gl = glCanvas.getContext("webgl2");
    if (!gl) {
      this.vscode.postMessage({
        type: "error",
        payload: ["❌ WebGL2 not supported"],
      });
      return null;
    }

    try {
      // Initialize managers
      const renderManager = new RenderManager();
      const success = await renderManager.initialize(gl, glCanvas);
      if (!success) {
        this.vscode.postMessage({
          type: "error",
          payload: ["❌ piRenderer could not initialize"],
        });
        return null;
      }

      const shaderCompiler = new ShaderCompiler();
      const resourceManager = new ResourceManager();
      resourceManager.setRenderer(renderManager.getRenderer());
      const timeManager = new TimeManager();
      const inputManager = new InputManager();
      const shaderManager = new ShaderManager(
        renderManager,
        shaderCompiler,
        resourceManager,
        timeManager,
        this.vscode,
      );
      const renderLoopManager = new RenderLoopManager(this.fpsCounter);

      this.vscode.postMessage({
        type: "debug",
        payload: ["Svelte with piLibs initialized"],
      });

      return {
        renderManager,
        shaderCompiler,
        resourceManager,
        timeManager,
        inputManager,
        shaderManager,
        renderLoopManager,
      };
    } catch (err) {
      this.vscode.postMessage({
        type: "error",
        payload: ["❌ Renderer initialization failed:", err],
      });
      return null;
    }
  }
}
