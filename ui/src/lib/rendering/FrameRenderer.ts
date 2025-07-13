import type { PassConfig } from "./ResourceManager";
import type { WebGLRenderer } from "./WebGLRenderer";
import type { ShaderPipeline } from "./ShaderPipeline";
import type { PassRenderer } from "./PassRenderer";
import { piCreateFPSCounter } from "../../../vendor/pilibs/src/piWebUtils";

export class FrameRenderer {
  private running = false;
  private fpsCounter: any;
  private currentFPS = 0;
  
  // Injected dependencies
  private timeManager: any;
  private inputManager: any;
  private webglRenderer: WebGLRenderer;
  private shaderPipeline: ShaderPipeline;
  private passRenderer: PassRenderer;
  private glCanvas: HTMLCanvasElement;

  constructor(
    timeManager: any,
    inputManager: any,
    webglRenderer: WebGLRenderer,
    shaderPipeline: ShaderPipeline,
    passRenderer: PassRenderer,
    glCanvas: HTMLCanvasElement,
  ) {
    this.fpsCounter = piCreateFPSCounter();
    this.timeManager = timeManager;
    this.inputManager = inputManager;
    this.webglRenderer = webglRenderer;
    this.shaderPipeline = shaderPipeline;
    this.passRenderer = passRenderer;
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
    const passes = this.shaderPipeline.getPasses();
    const passShaders = this.shaderPipeline.getPassShaders();
    const passBuffers = this.shaderPipeline.getPassBuffers();

    // --- Render all buffer passes ---
    for (const pass of passes) {
      if (pass.name === "Image") continue;
      const buffers = passBuffers[pass.name];
      const shader = passShaders[pass.name];
      const textureBindings = this.passRenderer.getTextureBindings(
        pass,
        this.inputManager,
        passBuffers,
      );
      this.passRenderer.renderPass(
        pass,
        buffers.back,
        shader,
        uniforms,
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
      const textureBindings = this.passRenderer.getTextureBindings(
        imagePass,
        this.inputManager,
        passBuffers,
      );
      this.passRenderer.renderPass(
        imagePass,
        null,
        shader,
        uniforms,
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
    const shader = this.shaderPipeline.getPassShaders()[pass.name];
    const textureBindings = this.passRenderer.getTextureBindings(
      pass, 
      this.inputManager,
      this.shaderPipeline.getPassBuffers(),
    );
    
    this.passRenderer.renderPass(pass, null, shader, uniforms, textureBindings);
  }
}
