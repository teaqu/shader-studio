import { RenderingEngine as RenderingEngineImpl } from "../../../rendering/src/RenderingEngine";
import type { RenderingEngine } from "../../../rendering/src/types";
import { MessageHandler } from "./transport/MessageHandler";
import type { Transport } from "./transport/MessageTransport";
import type { ErrorMessage, DebugMessage } from "@shader-studio/types";

export class ShaderStudio {
  private transport: Transport;
  private glCanvas: HTMLCanvasElement | null = null;
  private renderingEngine!: RenderingEngine;
  private messageHandler!: MessageHandler;

  constructor(transport: Transport) {
    this.transport = transport;
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
      this.renderingEngine = new RenderingEngineImpl();
      this.renderingEngine.initialize(glCanvas);

      this.messageHandler = new MessageHandler(
        this.renderingEngine,
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

    this.renderingEngine.handleCanvasResize(width, height);
  }

  async handleShaderMessage(
    event: MessageEvent,
  ): Promise<{ running: boolean }> {
    const result = await this.messageHandler.handleShaderMessage(event);
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
    const isLocked = this.renderingEngine.isLockedShader();

    if (isLocked) {
      const lockedShaderPath = this.renderingEngine.getLockedShaderPath();
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
    this.renderingEngine.toggleLock(currentShaderPath);
  }

  getIsLocked(): boolean {
    return this.renderingEngine.isLockedShader();
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

  dispose(): void {
    // Clean up resources
    if (this.renderingEngine) {
      this.renderingEngine.dispose();
    }
  }
}
