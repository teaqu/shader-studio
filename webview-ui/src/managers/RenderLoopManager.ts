import type { PassConfig } from "./ResourceManager";

export class RenderLoopManager {
  private running = false;
  private fpsCounter: any;
  private currentFPS = 0;

  constructor(fpsCounter: any) {
    this.fpsCounter = fpsCounter;
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

  public render(
    time: number,
    renderID: number,
    currentShaderRenderID: number,
    timeManager: any,
    inputManager: any,
    renderManager: any,
    shaderManager: any,
    glCanvas: HTMLCanvasElement,
  ): void {
    if (!this.running || renderID !== currentShaderRenderID) return;

    if (timeManager.getFrame() === 0) {
      this.fpsCounter.Reset(time);
    }

    if (this.fpsCounter.Count(time)) {
      this.currentFPS = this.fpsCounter.GetFPS();
    }

    const uniforms = timeManager.getUniforms(
      glCanvas.width,
      glCanvas.height,
      inputManager.getMouse(),
    );
    const passes = shaderManager.getPasses();
    const passShaders = shaderManager.getPassShaders();
    const passBuffers = shaderManager.getPassBuffers();

    // --- Render all buffer passes ---
    for (const pass of passes) {
      if (pass.name === "Image") continue;
      const buffers = passBuffers[pass.name];
      const shader = passShaders[pass.name];
      const textureBindings = shaderManager.getTextureBindings(
        pass,
        inputManager,
      );
      renderManager.drawPass(
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
      const textureBindings = shaderManager.getTextureBindings(
        imagePass,
        inputManager,
      );
      renderManager.drawPass(
        imagePass,
        null,
        uniforms,
        shader,
        textureBindings,
      );
    }

    // Clear the "just pressed" state for the next frame
    inputManager.clearPressed();

    timeManager.incrementFrame();
    // Don't call requestAnimationFrame here - let the controller handle it
  }
}
