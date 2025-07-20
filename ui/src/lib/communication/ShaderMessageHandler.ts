import type { ShaderPipeline } from "../rendering/ShaderPipeline";
import type { TimeManager } from "../input/TimeManager";
import type { FrameRenderer } from "../rendering/FrameRenderer";

export class ShaderMessageHandler {
  private shaderPipeline: ShaderPipeline;
  private timeManager: TimeManager;
  private frameRenderer: FrameRenderer;
  private vscode: any;
  private isHandlingMessage = false;
  private lastEvent: MessageEvent | null = null;

  constructor(
    shaderPipeline: ShaderPipeline,
    timeManager: TimeManager,
    frameRenderer: FrameRenderer,
    vscode: any,
  ) {
    this.shaderPipeline = shaderPipeline;
    this.timeManager = timeManager;
    this.frameRenderer = frameRenderer;
    this.vscode = vscode;
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
  }

  public async handleShaderMessage(
    event: MessageEvent,
    onLockStateChange: (locked: boolean) => void,
  ): Promise<{ running: boolean }> {
    let { type, code, config, name, buffers = {}, isLocked: incomingLocked } =
      event.data;

    if (type !== "shaderSource" || this.isHandlingMessage) {
      return { running: false };
    }

    // Update lock state from extension
    if (incomingLocked !== undefined) {
      onLockStateChange(incomingLocked);
    }

    this.isHandlingMessage = true;
    try {
      const result = await this.shaderPipeline.compileShaderPipeline(
        code,
        config,
        name,
        buffers,
      );

      if (!result.success) {
        this.vscode.postMessage({
          type: "error",
          payload: [result.error],
        });
        return { running: true };
      }

      this.vscode.postMessage({
        type: "log",
        payload: ["Shader compiled and linked"],
      });
      this.lastEvent = event;

      // Start render loop if not already running
      if (!this.frameRenderer.isRunning()) {
        this.frameRenderer.startRenderLoop();
      }

      return { running: true };
    } finally {
      this.isHandlingMessage = false;
    }
  }

  public reset(onReset?: () => void): void {
    this.shaderPipeline.cleanup();
    this.timeManager.cleanup(); // Reset the time manager
    
    if (this.lastEvent && onReset) {
      onReset();
    } else {
      this.vscode.postMessage({
        type: "error",
        payload: ["❌ No shader to reset"],
      });
    }
  }
}
