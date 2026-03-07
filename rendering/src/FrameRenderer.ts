import type { ShaderPipeline } from "./ShaderPipeline";
import type { BufferManager } from "./BufferManager";
import type { CubemapBufferManager } from "./CubemapBufferManager";
import { CUBEMAP_CORNERS } from "./CubemapBufferManager";
import type { PassRenderer } from "./PassRenderer";
import type { ResourceManager } from "./ResourceManager";
import type { Pass, PassUniforms } from "./models";
import type { PiRenderer, PiShader } from "./types/piRenderer";
import type { TimeManager } from "./util/TimeManager";
import type { KeyboardManager } from "./input/KeyboardManager";
import type { MouseManager } from "./input/MouseManager";
import { FPSCalculator } from "./util/FPSCalculator";

export class FrameRenderer {
  private running = false;
  private currentFrameTime = 0;
  private frameCount = 0;
  private fpsCalculator: FPSCalculator;

  private timeManager: TimeManager;
  private keyboardManager: KeyboardManager;
  private mouseManager: MouseManager;
  private shaderPipeline: ShaderPipeline;
  private bufferManager: BufferManager;
  private passRenderer: PassRenderer;
  private resourceManager: ResourceManager;
  private cubemapBufferManager: CubemapBufferManager | null = null;
  private piRenderer: PiRenderer | null = null;
  private glCanvas: HTMLCanvasElement;
  private sampleRate: number = 44100;

  constructor(
    timeManager: TimeManager,
    keyboardManager: KeyboardManager,
    mouseManager: MouseManager,
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
    this.shaderPipeline = pipeline;
    this.bufferManager = bufferManager;
    this.passRenderer = passRenderer;
    this.resourceManager = resourceManager;
    this.glCanvas = glCanvas;
    this.fpsCalculator = fpsCalculator;
  }

  public setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }

  public setCubemapBufferManager(manager: CubemapBufferManager): void {
    this.cubemapBufferManager = manager;
  }

  public setPiRenderer(renderer: PiRenderer): void {
    this.piRenderer = renderer;
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
      } else if (input.type === 'cubemap') {
        channelLoaded[i] = this.cubemapBufferManager?.getCubemapTexture() ? 1 : 0;
      } else if (input.type === 'volume' && input.path) {
        const path = input.resolved_path || input.path;
        channelLoaded[i] = this.resourceManager.getVolumeTexture(path) ? 1 : 0;
      }
    }

    return {
      ...baseUniforms,
      channelTime,
      channelLoaded,
    };
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

    this.timeManager.updateFrame(time);

    const currentFrame = this.timeManager.getFrame();
    const deltaTime = this.timeManager.getDeltaTime();

    // Skip duplicate frames from VS Code multi-panel rendering (but allow first frame)
    // See test not sure why this happens
    if (deltaTime === 0 && currentFrame !== 0) {
      return;
    }

    this.currentFrameTime = time;
    this.updateFPSTracking(time);

    // Update audio textures (FFT/waveform data) each frame
    this.resourceManager.updateAudioTextures();

    const uniforms = this.getUniforms();
    const isPaused = this.timeManager.isPaused();

    if (!isPaused || currentFrame === 0) {
      this.renderCubemapPass(uniforms);
      this.renderBufferPasses(uniforms);
    }
    
    this.renderImagePass(uniforms);
    this.keyboardManager.clearPressed();

    if (!isPaused) {
      this.timeManager.incrementFrame();
    }
  }

  private updateFPSTracking(time: number): void {
    if (this.timeManager.getFrame() === 0) {
      this.frameCount = 0;
      this.fpsCalculator.reset();
    } else if (!this.timeManager.isPaused()) {
      this.fpsCalculator.updateFrame(time);
      this.frameCount++;
    }
  }

  private renderCubemapPass(uniforms: PassUniforms): void {
    if (!this.cubemapBufferManager || !this.piRenderer) return;

    const passes = this.shaderPipeline.getPasses();
    const cubePass = passes.find((p: Pass) => p.name === "CubeA");
    if (!cubePass) return;

    const shader = this.shaderPipeline.getPassShaders()["CubeA"] as PiShader | undefined;
    if (!shader) return;

    const buffer = this.cubemapBufferManager.getBuffer();
    if (!buffer) return;

    const passUniforms = this.getPassUniforms(cubePass, uniforms);
    const dstIdx = 1 - buffer.currentIndex;
    const res = this.cubemapBufferManager.getResolution();

    this.piRenderer.AttachShader(shader);

    // Set standard uniforms
    this.piRenderer.SetShaderConstant3FV("iResolution", [res, res, 1]);
    this.piRenderer.SetShaderConstant1F("iTime", passUniforms.time);
    this.piRenderer.SetShaderConstant1F("iTimeDelta", passUniforms.timeDelta);
    this.piRenderer.SetShaderConstant1F("iFrameRate", passUniforms.frameRate);
    this.piRenderer.SetShaderConstant4FV("iMouse", passUniforms.mouse);
    this.piRenderer.SetShaderConstant1I("iFrame", passUniforms.frame);
    this.piRenderer.SetShaderConstant4FV("iDate", passUniforms.date);
    this.piRenderer.SetShaderConstant1FV("iChannelTime", passUniforms.channelTime);
    this.piRenderer.SetShaderConstant1F("iSampleRate", passUniforms.sampleRate);
    this.piRenderer.SetShaderConstant4FV("unViewport", [0, 0, res, res]);

    const posLoc = this.piRenderer.GetAttribLocation(shader, "position");

    // Render 6 faces
    for (let face = 0; face < 6; face++) {
      this.piRenderer.SetRenderTargetCubeMap(buffer.target[dstIdx], face);
      this.piRenderer.SetViewport([0, 0, res, res]);

      // Set corner vectors for this face (5 vec3 = 15 floats)
      this.piRenderer.SetShaderConstant3FV("unCorners[0]", CUBEMAP_CORNERS[face]);

      this.piRenderer.DrawUnitQuad_XY(posLoc);
    }

    this.piRenderer.SetRenderTarget(null);
    this.cubemapBufferManager.swapBuffers();
  }

  private renderBufferPasses(uniforms: PassUniforms): void {
    const passes = this.shaderPipeline.getPasses();
    const passShaders = this.shaderPipeline.getPassShaders();
    const passBuffers = this.bufferManager.getPassBuffers();

    for (const pass of passes) {
      if (pass.name === "Image" || pass.name === "common" || pass.name === "CubeA") {
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

  private renderImagePass(uniforms: PassUniforms): void {
    const passes = this.shaderPipeline.getPasses();
    const imagePass = passes.find((p: Pass) => p.name === "Image");

    if (imagePass) {
      const passShaders = this.shaderPipeline.getPassShaders();
      const shader = passShaders[imagePass.name];
      const passUniforms = this.getPassUniforms(imagePass, uniforms);
      this.passRenderer.renderPass(imagePass, null, shader, passUniforms);
    }
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
