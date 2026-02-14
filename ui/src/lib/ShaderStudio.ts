import type { RenderingEngine } from "../../../rendering/src/types";
import { ShaderLocker } from "./ShaderLocker";
import { MessageHandler } from "./transport/MessageHandler";
import type { Transport } from "./transport/MessageTransport";
import type { ErrorMessage, DebugMessage } from "@shader-studio/types";
import { ShaderDebugManager } from "./ShaderDebugManager";

export class ShaderStudio {
  private transport: Transport;
  private glCanvas: HTMLCanvasElement | null = null;
  private renderingEngine!: RenderingEngine;
  private messageHandler!: MessageHandler;
  private shaderLocker!: ShaderLocker;
  private shaderDebugManager: ShaderDebugManager;

  constructor(transport: Transport, shaderLocker: ShaderLocker, renderingEngine: RenderingEngine, shaderDebugManager: ShaderDebugManager) {
    this.transport = transport;
    this.shaderLocker = shaderLocker;
    this.renderingEngine = renderingEngine;
    this.shaderDebugManager = shaderDebugManager;
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
      this.renderingEngine.initialize(glCanvas, true); // Enable preserveDrawingBuffer for pixel reading

      this.messageHandler = new MessageHandler(
        this.transport,
        this.renderingEngine,
        this.shaderLocker,
        this.shaderDebugManager,
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

    this.renderingEngine.handleCanvasResize(width, height);
  }

  handleShaderMessage(
    event: MessageEvent,
  ): void {
    this.messageHandler.handleShaderMessage(event);
  }

  handleReset(onComplete?: () => void): void {
    this.messageHandler.reset(() => {
      if (onComplete) {
        onComplete();
      }
    });
  }

  handleRefresh(): void {
    if (this.shaderLocker.isLocked()) {
      const lockedShaderPath = this.shaderLocker.getLockedShaderPath();
      console.log('Shader Studio: Refreshing locked shader at path:', lockedShaderPath);

      this.messageHandler.refresh(lockedShaderPath || undefined);
    } else {
      console.log('Shader Studio: Refreshing current shader');
      this.messageHandler.refresh();
    }
  }

  handleTogglePause(): void {
    this.renderingEngine.togglePause();
  }

  handleToggleLock(): void {
    const lastEvent = this.messageHandler.getLastEvent();
    const currentShaderPath = lastEvent?.data?.path;
    this.shaderLocker.toggleLock(currentShaderPath);
  }

  getIsLocked(): boolean {
    return this.shaderLocker.isLocked();
  }

  stopRenderLoop(): void {
    this.renderingEngine.stopRenderLoop();
  }

  getCurrentFPS(): number {
    return this.renderingEngine.getCurrentFPS();
  }

  getLastShaderEvent(): MessageEvent | null {
    return this.messageHandler.getLastEvent();
  }

  getTimeManager(): any {
    return this.renderingEngine.getTimeManager();
  }

  getRenderingEngine() {
    return this.renderingEngine;
  }

  triggerDebugRecompile(): void {
    if (this.messageHandler) {
      this.messageHandler.triggerDebugRecompile();
    }
  }

  dispose(): void {
    // Clean up resources
    if (this.renderingEngine) {
      this.renderingEngine.dispose();
    }
  }
}
