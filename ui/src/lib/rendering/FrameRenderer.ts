import type { ShaderPipeline } from "./ShaderPipeline";
import type { BufferManager } from "./BufferManager";
import type { PassRenderer } from "./PassRenderer";
import { piCreateFPSCounter } from "../../../vendor/pilibs/src/piWebUtils";
import type { Pass } from "../models";
import type { TimeManager } from "../input/TimeManager";
import type { KeyboardManager } from "../input/KeyboardManager";
import type { MouseManager } from "../input/MouseManager";

export class FrameRenderer {
  private running = false;
  private fpsCounter: any;
  private currentFPS = 0;
  private currentFrameTime = 0;

  private timeManager: TimeManager;
  private keyboardManager: KeyboardManager;
  private mouseManager: MouseManager;
  private shaderPipeline: ShaderPipeline;
  private bufferManager: BufferManager;
  private passRenderer: PassRenderer;
  private glCanvas: HTMLCanvasElement;

  constructor(
    timeManager: TimeManager,
    keyboardManager: KeyboardManager,
    mouseManager: MouseManager,
    pipeline: ShaderPipeline,
    bufferManager: BufferManager,
    passRenderer: PassRenderer,
    glCanvas: HTMLCanvasElement
  ) {
    this.fpsCounter = piCreateFPSCounter();
    this.timeManager = timeManager;
    this.keyboardManager = keyboardManager;
    this.mouseManager = mouseManager;
    this.shaderPipeline = pipeline;
    this.bufferManager = bufferManager;
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

  private getUniforms(): any {
    return {
      res: new Float32Array([
        this.glCanvas.width,
        this.glCanvas.height,
        this.glCanvas.width / this.glCanvas.height,
      ]),
      time: this.timeManager.getCurrentTime(this.currentFrameTime),
      timeDelta: this.timeManager.getDeltaTime(),
      frameRate: this.currentFPS, // Use the existing FPS counter
      mouse: this.mouseManager.getMouse(),
      frame: this.timeManager.getFrame(),
    };
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

    this.currentFrameTime = time;

    if (this.timeManager.getFrame() === 0) {
      this.fpsCounter.Reset(time);
    }

    if (!this.timeManager.isPaused() && this.fpsCounter.Count(time)) {
      this.currentFPS = this.fpsCounter.GetFPS();
    }

    this.timeManager.updateFrame(time);

    const uniforms = this.getUniforms();
    const passes = this.shaderPipeline.getPasses();
    const passShaders = this.shaderPipeline.getPassShaders();
    const passBuffers = this.bufferManager.getPassBuffers();

    for (const pass of passes) {
      if (pass.name === "Image") {
        continue;
      }

      const buffers = passBuffers[pass.name];
      const shader = passShaders[pass.name];
      this.passRenderer.renderPass(
        pass,
        buffers.back,
        shader,
        uniforms,
      );

      const temp = buffers.front;
      buffers.front = buffers.back;
      buffers.back = temp;
    }

    const imagePass = passes.find((p: Pass) => p.name === "Image");
    if (imagePass) {
      const shader = passShaders[imagePass.name];
      this.passRenderer.renderPass(
        imagePass,
        null,
        shader,
        uniforms,
      );
    }

    this.keyboardManager.clearPressed();

    if (!this.timeManager.isPaused()) {
      this.timeManager.incrementFrame();
    }
  }

  public renderSinglePass(pass: Pass): void {
    const uniforms = this.getUniforms();
    const shader = this.shaderPipeline.getPassShader(pass.name) || null;

    this.passRenderer.renderPass(
      pass,
      null,
      shader,
      uniforms,
    );
  }
}
