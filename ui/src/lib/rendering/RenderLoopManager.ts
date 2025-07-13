import type { PassConfig } from "./ResourceManager";
import { piCreateFPSCounter } from "../../../vendor/pilibs/src/piWebUtils";

export class RenderLoopManager {
  private running = false;
  private fpsCounter: any;
  private currentFPS = 0;
  
  // Injected dependencies
  private timeManager: any;
  private inputManager: any;
  private renderManager: any;
  private shaderManager: any;
  private glCanvas: HTMLCanvasElement;

  constructor(
    timeManager: any,
    inputManager: any,
    renderManager: any,
    shaderManager: any,
    glCanvas: HTMLCanvasElement,
  ) {
    this.fpsCounter = piCreateFPSCounter();
    this.timeManager = timeManager;
    this.inputManager = inputManager;
    this.renderManager = renderManager;
    this.shaderManager = shaderManager;
    this.glCanvas = glCanvas;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public setRunning(running: boolean): void {
    this.running = running;
  }

  public getCurrentFPS(): number {
    return this.currentFPS;
  }

  public startRenderLoop(): void {
    if (this.running) return; // Already running
    
    this.running = true;

    const render = (time: number) => {
      if (!this.running || !this.glCanvas) return;

      this.render(time);

      if (this.running) {
        requestAnimationFrame(render);
      }
    };

    requestAnimationFrame(render);
  }

  public stopRenderLoop(): void {
    this.running = false;
  }

  public render(time: number): void {
    if (!this.running) return;

    if (this.timeManager.getFrame() === 0) {
      this.fpsCounter.Reset(time);
    }

    if (this.fpsCounter.Count(time)) {
      this.currentFPS = this.fpsCounter.GetFPS();
    }

    const uniforms = this.timeManager.getUniforms(
      this.glCanvas.width,
      this.glCanvas.height,
      this.inputManager.getMouse(),
    );
    const passes = this.shaderManager.getPasses();
    const passShaders = this.shaderManager.getPassShaders();
    const passBuffers = this.shaderManager.getPassBuffers();

    // --- Render all buffer passes ---
    for (const pass of passes) {
      if (pass.name === "Image") continue;
      const buffers = passBuffers[pass.name];
      const shader = passShaders[pass.name];
      const textureBindings = this.shaderManager.getTextureBindings(
        pass,
        this.inputManager,
      );
      this.renderManager.drawPass(
        pass,
        buffers.back,
        uniforms,
        shader,
        textureBindings,
      );

      const temp = buffers.front;
      buffers.front = buffers.back;
      buffers.back = temp;
    }

    // --- Render final Image pass to screen ---
    const imagePass = passes.find((p: PassConfig) => p.name === "Image");
    if (imagePass) {
      const shader = passShaders[imagePass.name];
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

    // Clear the "just pressed" state for the next frame
    this.inputManager.clearPressed();

    this.timeManager.incrementFrame();
  }

  public renderSinglePass(pass: PassConfig): void {
    const uniforms = this.timeManager.getUniforms(
      this.glCanvas.width,
      this.glCanvas.height,
      this.inputManager.getMouse(),
    );
    const shader = this.shaderManager.getPassShaders()[pass.name];
    const textureBindings = this.shaderManager.getTextureBindings(pass, this.inputManager);
    
    this.renderManager.drawPass(pass, null, uniforms, shader, textureBindings);
  }
}
