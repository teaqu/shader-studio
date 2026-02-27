import type { RenderingEngine } from "../../../rendering/src/types";
import { ShaderLocker } from "./ShaderLocker";
import { MessageHandler } from "./transport/MessageHandler";
import type { Transport } from "./transport/MessageTransport";
import type { ErrorMessage, DebugMessage } from "@shader-studio/types";
import { ShaderDebugManager } from "./ShaderDebugManager";
import type { CompilationResult } from "./ShaderProcessor";

export class ShaderStudio {
  private transport: Transport;
  private renderingEngine!: RenderingEngine;
  private messageHandler!: MessageHandler;
  private shaderLocker!: ShaderLocker;
  private shaderDebugManager: ShaderDebugManager;

  constructor(
    transport: Transport,
    shaderLocker: ShaderLocker,
    renderingEngine: RenderingEngine,
    shaderDebugManager: ShaderDebugManager
  ) {
    this.transport = transport;
    this.shaderLocker = shaderLocker;
    this.renderingEngine = renderingEngine;
    this.shaderDebugManager = shaderDebugManager;
  }

  async initialize(glCanvas: HTMLCanvasElement): Promise<boolean> {
    try {
      this.renderingEngine.initialize(glCanvas, true); // Enable preserveDrawingBuffer for pixel reading

      this.messageHandler = new MessageHandler(
        this.transport,
        this.renderingEngine,
        this.shaderLocker,
        this.shaderDebugManager
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

  async handleShaderMessage(
    event: MessageEvent,
  ): Promise<CompilationResult | undefined> {
    return await this.messageHandler.handleShaderMessage(event);
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

  handleToggleLock(): void {
    const lastEvent = this.messageHandler.getLastEvent();
    const currentShaderPath = lastEvent?.data?.path;
    this.shaderLocker.toggleLock(currentShaderPath);
  }

  getIsLocked(): boolean {
    return this.shaderLocker.isLocked();
  }

  getLockedShaderPath(): string | undefined {
    return this.shaderLocker.getLockedShaderPath();
  }

  getLastShaderEvent(): MessageEvent | null {
    return this.messageHandler.getLastEvent();
  }

  getRenderingEngine() {
    return this.renderingEngine;
  }

  triggerDebugRecompile(): void {
    if (this.messageHandler) {
      this.messageHandler.triggerDebugRecompile();
    }
  }
}
