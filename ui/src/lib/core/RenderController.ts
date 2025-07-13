import type { ManagerInstances } from "./AppInitializer";
import type { TimeManager } from "../input/TimeManager";
import type { InputManager } from "../input/InputManager";
import type { RenderManager } from "../rendering/RenderManager";
import type { ShaderManager } from "../rendering/ShaderManager";
import type { RenderLoopManager } from "../rendering/RenderLoopManager";

export class RenderController {
  private managers: ManagerInstances;
  private vscode: any;
  private glCanvas: HTMLCanvasElement;
  private renderLoopActive = false;

  constructor(
    managers: ManagerInstances,
    vscode: any,
    glCanvas: HTMLCanvasElement,
  ) {
    this.managers = managers;
    this.vscode = vscode;
    this.glCanvas = glCanvas;
  }

  handleCanvasResize(width: number, height: number) {
    this.managers.renderManager.updateCanvasSize(width, height);
    const newBuffers = this.managers.renderManager.resizePassBuffers(
      this.managers.shaderManager.getPasses(),
      Math.round(width),
      Math.round(height),
    );
    this.managers.shaderManager.setPassBuffers(newBuffers);

    // Redraw the final image pass to prevent a black screen flicker.
    const imagePass = this.managers.shaderManager.getPasses().find((p) =>
      p.name === "Image"
    );
    if (imagePass && this.managers.renderLoopManager.isRunning()) {
      const uniforms = this.managers.timeManager.getUniforms(
        this.glCanvas.width,
        this.glCanvas.height,
        this.managers.inputManager.getMouse(),
      );
      const shader =
        this.managers.shaderManager.getPassShaders()[imagePass.name];
      const textureBindings = this.managers.shaderManager.getTextureBindings(
        imagePass,
        this.managers.inputManager,
      );
      this.managers.renderManager.drawPass(
        imagePass,
        null,
        uniforms,
        shader,
        textureBindings,
      );
    }
  }

  async handleShaderMessage(
    event: MessageEvent,
    onLockChange: (locked: boolean) => void,
  ) {
    const result = await this.managers.shaderManager.handleShaderMessage(
      event,
      onLockChange,
    );

    if (result.running && !this.renderLoopActive) {
      this.managers.renderLoopManager.setRunning(true);
      this.startRenderLoop();
    }
  }

  handleReset(onComplete?: () => void) {
    this.managers.shaderManager.reset(() => {
      if (onComplete) {
        onComplete();
      }
    });
  }

  handleTogglePause() {
    this.managers.timeManager.togglePause();
  }

  handleToggleLock() {
    this.vscode.postMessage({ type: "toggleLock" });
  }

  private startRenderLoop() {
    this.renderLoopActive = true;

    const render = (time: number) => {
      if (!this.renderLoopActive) return;

      this.managers.renderLoopManager.render(
        time,
        this.managers.shaderManager.getCurrentShaderRenderID(),
        this.managers.shaderManager.getCurrentShaderRenderID(),
        this.managers.timeManager,
        this.managers.inputManager,
        this.managers.renderManager,
        this.managers.shaderManager,
        this.glCanvas,
      );

      if (this.managers.renderLoopManager.isRunning()) {
        requestAnimationFrame(render);
      } else {
        this.renderLoopActive = false;
      }
    };

    requestAnimationFrame(render);
  }

  stopRenderLoop() {
    this.renderLoopActive = false;
    this.managers.renderLoopManager.setRunning(false);
  }

  getManagers(): ManagerInstances {
    return this.managers;
  }
}
