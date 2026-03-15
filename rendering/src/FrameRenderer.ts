import type { ShaderPipeline } from "./ShaderPipeline";
import type { BufferManager } from "./BufferManager";
import type { PassRenderer } from "./PassRenderer";
import type { ResourceManager } from "./ResourceManager";
import type { Pass, PassUniforms } from "./models";
import type { TimeManager } from "./util/TimeManager";
import type { KeyboardManager } from "./input/KeyboardManager";
import type { MouseManager } from "./input/MouseManager";
import type { CameraManager } from "./input/CameraManager";
import { FPSCalculator } from "./util/FPSCalculator";

export class FrameRenderer {
  private running = false;
  private currentFrameTime = 0;
  private fpsLimit = 0;
  private lastRenderedAt: number | null = null;
  private fpsCalculator: FPSCalculator;
  private frameTimeBuffer: number[] = new Array(3600);
  private frameTimeHead = 0;   // write index (circular)
  private frameTimeLen = 0;    // current occupied length
  private frameTimeCount = 0;  // total frames ever recorded
  private static MAX_HISTORY = 3600;
  private previousFrameTimestamp: number | null = null;
  private pausedUniforms: PassUniforms | null = null;

  private timeManager: TimeManager;
  private keyboardManager: KeyboardManager;
  private mouseManager: MouseManager;
  private shaderPipeline: ShaderPipeline;
  private bufferManager: BufferManager;
  private passRenderer: PassRenderer;
  private resourceManager: ResourceManager;
  private cameraManager: CameraManager;
  private glCanvas: HTMLCanvasElement;
  private sampleRate: number = 44100;
  private lastWallTime: number | null = null;

  constructor(
    timeManager: TimeManager,
    keyboardManager: KeyboardManager,
    mouseManager: MouseManager,
    cameraManager: CameraManager,
    pipeline: ShaderPipeline,
    bufferManager: BufferManager,
    passRenderer: PassRenderer,
    resourceManager: ResourceManager,
    glCanvas: HTMLCanvasElement,
    fpsCalculator: FPSCalculator,
  ) {
    this.timeManager = timeManager;
    this.keyboardManager = keyboardManager;
    this.mouseManager = mouseManager;
    this.cameraManager = cameraManager;
    this.shaderPipeline = pipeline;
    this.bufferManager = bufferManager;
    this.passRenderer = passRenderer;
    this.resourceManager = resourceManager;
    this.glCanvas = glCanvas;
    this.fpsCalculator = fpsCalculator;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public setRunning(running: boolean): void {
    this.running = running;
  }

  public getCurrentFPS(): number {
    return this.fpsCalculator.getFPS();
  }

  public setFPSLimit(limit: number): void {
    this.fpsLimit = limit;
    this.lastRenderedAt = null;
  }

  public getUniforms(): PassUniforms {
    return {
      res: new Float32Array([
        this.glCanvas.width,
        this.glCanvas.height,
        this.glCanvas.width / this.glCanvas.height,
      ]),
      time: this.timeManager.getCurrentTime(this.currentFrameTime),
      timeDelta: this.timeManager.getDeltaTime(),
      frameRate: this.fpsCalculator.getRawFPS(),
      mouse: this.mouseManager.getMouse(),
      frame: this.timeManager.getFrame(),
      date: this.timeManager.getCurrentDate(),
      channelTime: [0, 0, 0, 0],
      sampleRate: this.resourceManager.getAudioSampleRate() || this.sampleRate,
      channelLoaded: [0, 0, 0, 0],
      cameraPos: this.cameraManager.getCameraPos(),
      cameraDir: this.cameraManager.getCameraDir(),
    };
  }

  private getPassUniforms(pass: Pass, baseUniforms: PassUniforms): PassUniforms {
    const channelTime = [0, 0, 0, 0];
    const channelLoaded = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const input = pass.inputs[`iChannel${i}`];
      if (!input) continue;

      if (input.type === 'video' && input.path) {
        const path = input.resolved_path || input.path;
        const video = this.resourceManager.getVideoElement(path);
        if (video) {
          channelTime[i] = video.currentTime;
          channelLoaded[i] = 1;
        }
      } else if (input.type === 'audio' && input.path) {
        const path = input.resolved_path || input.path;
        const audioState = this.resourceManager.getAudioState(path);
        if (audioState) {
          channelTime[i] = audioState.currentTime;
          channelLoaded[i] = 1;
        }
      } else if (input.type === 'texture' && input.path) {
        const path = input.resolved_path || input.path;
        const tex = this.resourceManager.getImageTextureCache()[path];
        channelLoaded[i] = tex ? 1 : 0;
      } else if (input.type === 'buffer') {
        const passBuffers = this.bufferManager.getPassBuffers();
        channelLoaded[i] = passBuffers[input.source]?.front?.mTex0 ? 1 : 0;
      } else if (input.type === 'keyboard') {
        channelLoaded[i] = this.resourceManager.getKeyboardTexture() ? 1 : 0;
      }
    }

    return {
      ...baseUniforms,
      channelTime,
      channelLoaded,
    };
  }

  /**
   * Render a single frame unconditionally for capture.
   * Bypasses running flag, FPS limit, and duplicate frame skip.
   */
  public renderForCapture(): void {
    this.currentFrameTime = performance.now();
    const uniforms = this.getUniforms();
    this.renderBufferPasses(uniforms);
    this.renderImagePass(uniforms);
  }

  public startRenderLoop(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    const render = (time: number) => {
      if (!this.running || !this.glCanvas) {
        return;
      }

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
    if (!this.running) {
      return;
    }

    if (this.fpsLimit > 0 && this.lastRenderedAt !== null) {
      const minFrameInterval = 1000 / this.fpsLimit;
      const elapsed = time - this.lastRenderedAt;
      if (elapsed < minFrameInterval * 0.9) {
        return;
      }
      // Drift-correct to maintain target cadence: advance by the exact
      // interval so small timing errors don't accumulate.
      this.lastRenderedAt += minFrameInterval;
      // If we've fallen far behind (e.g. tab was backgrounded), snap to
      // current time so we don't rapid-fire to catch up.
      if (this.lastRenderedAt < time - minFrameInterval) {
        this.lastRenderedAt = time;
      }
    }

    this.timeManager.updateFrame(time);

    const currentFrame = this.timeManager.getFrame();
    const deltaTime = this.timeManager.getDeltaTime();

    // Skip duplicate frames from VS Code multi-panel rendering (but allow first frame)
    // See test not sure why this happens
    if (deltaTime === 0 && currentFrame !== 0) {
      return;
    }

    if (this.fpsLimit <= 0 || this.lastRenderedAt === null) {
      this.lastRenderedAt = time;
    }
    this.currentFrameTime = time;
    this.updateFPSTracking(time);

    // Update audio textures (FFT/waveform data) each frame
    this.resourceManager.updateAudioTextures();

    // Update camera with wall-clock delta (works even when paused)
    const wallDt = this.lastWallTime !== null ? (time - this.lastWallTime) / 1000 : 0;
    this.lastWallTime = time;
    this.cameraManager.update(wallDt);

    const isPaused = this.timeManager.isPaused();

    // Freeze all uniforms while paused: cache on entering pause, reuse until unpaused
    if (isPaused && this.pausedUniforms === null) {
      this.pausedUniforms = this.getUniforms();
    } else if (!isPaused) {
      this.pausedUniforms = null;
    }

    const uniforms = this.pausedUniforms ?? this.getUniforms();

    if (!isPaused || currentFrame === 0) {
      this.renderBufferPasses(uniforms);
    }

    this.renderImagePass(uniforms, isPaused);

    // Track actual frame-to-frame wall time (RAF delta) only when running
    if (!isPaused) {
      if (this.previousFrameTimestamp !== null) {
        const frameDelta = time - this.previousFrameTimestamp;
        // Ignore unreasonable spikes (e.g. tab was backgrounded)
        if (frameDelta < 500) {
          this.frameTimeBuffer[this.frameTimeHead] = frameDelta;
          this.frameTimeHead = (this.frameTimeHead + 1) % FrameRenderer.MAX_HISTORY;
          if (this.frameTimeLen < FrameRenderer.MAX_HISTORY) this.frameTimeLen++;
          this.frameTimeCount++;
        }
      }
      this.previousFrameTimestamp = time;
    } else {
      // Reset so we don't get a huge spike when unpausing
      this.previousFrameTimestamp = null;
    }

    this.keyboardManager.clearPressed();

    if (!isPaused) {
      this.timeManager.incrementFrame();
    }
  }

  private updateFPSTracking(time: number): void {
    if (this.timeManager.getFrame() === 0) {
      this.fpsCalculator.reset();
    } else if (!this.timeManager.isPaused()) {
      this.fpsCalculator.updateFrame(time);
    }
  }

  private renderBufferPasses(uniforms: PassUniforms): void {
    const passes = this.shaderPipeline.getPasses();
    const passShaders = this.shaderPipeline.getPassShaders();
    const passBuffers = this.bufferManager.getPassBuffers();

    for (const pass of passes) {
      if (pass.name === "Image" || pass.name === "common") {
        continue;
      }

      const buffers = passBuffers[pass.name];
      const shader = passShaders[pass.name];
      
      // Skip if buffers are missing (prevents "Cannot read properties of undefined (reading 'back')")
      if (!buffers) {
        console.warn(`Missing buffers for pass: ${pass.name}. Skipping render. This may indicate a configuration issue.`);
        continue;
      }
      
      const passUniforms = this.getPassUniforms(pass, uniforms);
      this.passRenderer.renderPass(pass, buffers.back, shader, passUniforms);

      // Swap front and back buffers
      [buffers.front, buffers.back] = [buffers.back, buffers.front];
    }
  }

  private renderImagePass(uniforms: PassUniforms, isPaused: boolean = false): void {
    const passes = this.shaderPipeline.getPasses();
    const imagePass = passes.find((p: Pass) => p.name === "Image");

    if (imagePass) {
      const passShaders = this.shaderPipeline.getPassShaders();
      const shader = passShaders[imagePass.name];
      if (shader) {
        const passUniforms = this.getPassUniforms(imagePass, uniforms);
        this.passRenderer.renderPass(imagePass, null, shader, passUniforms, isPaused);
      } else {
        this.passRenderer.clearCanvas();
      }
    } else {
      this.passRenderer.clearCanvas();
    }
  }

  public getFrameTimeHistory(): number[] {
    if (this.frameTimeLen === 0) return [];
    // Linearize the circular buffer into chronological order
    const start = (this.frameTimeHead - this.frameTimeLen + FrameRenderer.MAX_HISTORY) % FrameRenderer.MAX_HISTORY;
    if (start + this.frameTimeLen <= FrameRenderer.MAX_HISTORY) {
      return this.frameTimeBuffer.slice(start, start + this.frameTimeLen);
    }
    // Wraps around: concat tail + head
    return this.frameTimeBuffer.slice(start).concat(this.frameTimeBuffer.slice(0, this.frameTimeHead));
  }

  public getFrameTimeCount(): number {
    return this.frameTimeCount;
  }

  public renderSinglePass(pass: Pass): void {
    const baseUniforms = this.getUniforms();
    const passUniforms = this.getPassUniforms(pass, baseUniforms);
    const shader = this.shaderPipeline.getPassShader(pass.name) || null;

    this.passRenderer.renderPass(
      pass,
      null,
      shader,
      passUniforms,
    );
  }
}
