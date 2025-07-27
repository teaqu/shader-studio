import { piRenderer } from "../../vendor/pilibs/src/piRenderer";
import { ShaderCompiler } from "./rendering/ShaderCompiler";
import { ResourceManager } from "./rendering/ResourceManager";
import { BufferManager } from "./rendering/BufferManager";
import { TimeManager } from "./util/TimeManager";
import { KeyboardManager } from "./input/KeyboardManager";
import { MouseManager } from "./input/MouseManager";
import { ShaderPipeline } from "./rendering/ShaderPipeline";
import { MessageHandler } from "./transport/MessageHandler";
import { PassRenderer } from "./rendering/PassRenderer";
import { FrameRenderer } from "./rendering/FrameRenderer";
import { FPSCalculator } from "./util/FPSCalculator";
import { ShaderLocker } from "./util/ShaderLocker";
import type { PiRenderer } from "./types/piRenderer";
import type { Transport } from "./transport/MessageTransport";
import type { ErrorMessage, DebugMessage } from "@shader-view/types";

export class ShaderView {
  private transport: Transport;
  private glCanvas: HTMLCanvasElement | null = null;
  private renderer!: PiRenderer;

  private shaderCompiler!: ShaderCompiler;
  private resourceManager!: ResourceManager;
  private bufferManager!: BufferManager;
  private timeManager!: TimeManager;
  private keyboardManager!: KeyboardManager;
  private mouseManager!: MouseManager;
  private shaderPipeline!: ShaderPipeline;
  private messageHandler!: MessageHandler;
  private passRenderer!: PassRenderer;
  private frameRenderer!: FrameRenderer;
  private shaderLocker!: ShaderLocker;

  constructor(transport: Transport) {
    this.transport = transport;
    this.shaderLocker = new ShaderLocker();
  }

  async initialize(glCanvas: HTMLCanvasElement): Promise<boolean> {
    this.glCanvas = glCanvas;

    const gl = glCanvas.getContext("webgl2");
    if (!gl) {
      const errorMessage: ErrorMessage = {
        type: "error",
        payload: ["❌ WebGL2 not supported"],
      };
      this.transport.postMessage(errorMessage);
      return false;
    }

    try {
      this.renderer = piRenderer();
      const success = this.renderer.Initialize(gl);
      if (!success) {
        const errorMessage: ErrorMessage = {
          type: "error",
          payload: ["❌ piRenderer could not initialize"],
        };
        this.transport.postMessage(errorMessage);
        return false;
      }

      this.shaderCompiler = new ShaderCompiler(this.renderer);
      this.resourceManager = new ResourceManager(this.renderer);
      this.bufferManager = new BufferManager(this.renderer);
      this.timeManager = new TimeManager();
      this.keyboardManager = new KeyboardManager();
      this.mouseManager = new MouseManager();

      this.shaderPipeline = new ShaderPipeline(
        glCanvas,
        this.shaderCompiler,
        this.resourceManager,
        this.renderer,
        this.bufferManager,
      );

      this.passRenderer = new PassRenderer(
        glCanvas,
        this.resourceManager,
        this.bufferManager,
        this.renderer,
        this.keyboardManager,
      );

      this.frameRenderer = new FrameRenderer(
        this.timeManager,
        this.keyboardManager,
        this.mouseManager,
        this.shaderPipeline,
        this.bufferManager,
        this.passRenderer,
        glCanvas,
        new FPSCalculator(30, 5),
      );

      this.messageHandler = new MessageHandler(
        this.shaderPipeline,
        this.timeManager,
        this.frameRenderer,
        this.transport,
      );

      const debugMessage: DebugMessage = {
        type: "debug",
        payload: ["Svelte with piLibs initialized"],
      };
      this.transport.postMessage(debugMessage);

      return true;
    } catch (err) {
      const errorMessage: ErrorMessage = {
        type: "error",
        payload: ["❌ Renderer initialization failed:", String(err)],
      };
      this.transport.postMessage(errorMessage);
      return false;
    }
  }

  public handleCanvasResize(width: number, height: number): void {
    if (!this.glCanvas) {
      return;
    }

    const newWidth = Math.round(width);
    const newHeight = Math.round(height);

    if (this.glCanvas.width !== newWidth || this.glCanvas.height !== newHeight) {
      this.glCanvas.width = newWidth;
      this.glCanvas.height = newHeight;
    }

    this.bufferManager.resizeBuffers(
      newWidth,
      newHeight,
    );

    // Redraw the final image pass to prevent a black screen flicker.
    const imagePass = this.shaderPipeline.getPass("Image");
    if (imagePass && this.frameRenderer.isRunning()) {
      this.frameRenderer.renderSinglePass(imagePass);
    }
  }

  async handleShaderMessage(
    event: MessageEvent,
  ): Promise<{ running: boolean }> {
    const currentShaderPath = event.data?.path;

    if (!this.shaderLocker.shouldProcessShader(currentShaderPath)) {
      return { running: this.frameRenderer.isRunning() };
    }

    const result = await this.messageHandler.handleShaderMessage(event);
    if (result.running && currentShaderPath) {
      this.shaderLocker.updateLockedShader(currentShaderPath);
    }

    return result;
  }

  handleReset(onComplete?: () => void): void {
    this.messageHandler.reset(() => {
      if (onComplete) {
        onComplete();
      }
    });
  }

  handleRefresh(): void {
    const isLocked = this.shaderLocker.getIsLocked();

    if (isLocked) {
      const lockedShaderPath = this.shaderLocker.getLockedShaderPath();
      console.log('ShaderView: Refreshing locked shader at path:', lockedShaderPath);

      this.messageHandler.refresh(lockedShaderPath || undefined);
    } else {
      console.log('ShaderView: Refreshing current shader');
      this.messageHandler.refresh();
    }
  }

  handleTogglePause(): void {
    this.timeManager.togglePause();
  }

  handleToggleLock(): void {
    const lastEvent = this.messageHandler.getLastEvent();
    const currentShaderPath = lastEvent?.data?.path;
    this.shaderLocker.toggleLock(currentShaderPath);
  }

  getIsLocked(): boolean {
    return this.shaderLocker.getIsLocked();
  }

  stopRenderLoop(): void {
    this.frameRenderer.stopRenderLoop();
  }

  getTimeManager(): TimeManager {
    return this.timeManager;
  }

  getKeyboardManager(): KeyboardManager {
    return this.keyboardManager;
  }

  getMouseManager(): MouseManager {
    return this.mouseManager;
  }

  getCurrentFPS(): number {
    return this.frameRenderer.getCurrentFPS();
  }

  getLastShaderEvent(): MessageEvent | null {
    return this.messageHandler.getLastEvent();
  }

  dispose(): void {
    // Clean up resources
    if (this.bufferManager) {
      this.bufferManager.dispose();
    }
    if (this.frameRenderer) {
      this.frameRenderer.stopRenderLoop();
    }
  }
}
