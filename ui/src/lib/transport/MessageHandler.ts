import type { ShaderPipeline } from "../rendering/ShaderPipeline";
import type { TimeManager } from "../util/TimeManager";
import type { FrameRenderer } from "../rendering/FrameRenderer";
import type { Transport } from "./MessageTransport";

export class MessageHandler {
  private shaderPipeline: ShaderPipeline;
  private timeManager: TimeManager;
  private frameRenderer: FrameRenderer;
  private transport: Transport;
  private isHandlingMessage = false;
  private lastEvent: MessageEvent | null = null;

  constructor(
    shaderPipeline: ShaderPipeline,
    timeManager: TimeManager,
    frameRenderer: FrameRenderer,
    transport: Transport,
  ) {
    this.shaderPipeline = shaderPipeline;
    this.timeManager = timeManager;
    this.frameRenderer = frameRenderer;
    this.transport = transport;
  }

  public getLastEvent(): MessageEvent | null {
    return this.lastEvent;
  }

  public async handleShaderMessage(
    event: MessageEvent,
    onLockStateChange: (locked: boolean) => void,
  ): Promise<{ running: boolean }> {
    try {
      let { type, code, config, name, buffers = {}, isLocked: incomingLocked } =
        event.data;

      console.log('MessageHandler: Processing shader message:', { type, name, codeLength: code?.length });

      if (type !== "shaderSource" || this.isHandlingMessage) {
        console.log('MessageHandler: Ignoring message - wrong type or already handling');
        return { running: false };
      }

      // Update lock state from extension
      if (incomingLocked !== undefined) {
        onLockStateChange(incomingLocked);
      }

      this.isHandlingMessage = true;
      try {
        console.log('MessageHandler: Compiling shader pipeline...');
        const result = await this.shaderPipeline.compileShaderPipeline(
          code,
          config,
          name,
          buffers,
        );

        if (!result.success) {
          console.log('MessageHandler: Compilation failed:', result.error);
          this.transport.postMessage({
            type: "error",
            payload: [result.error],
          });
          return { running: true };
        }

        console.log('MessageHandler: Compilation successful');
        
        // Send log message in the format the WebSocket server expects
        this.transport.postMessage({
          type: "log",
          payload: ["Shader compiled and linked"], // Array format expected by server
        });
        
        this.lastEvent = event;

        // Start render loop if not already running
        if (!this.frameRenderer.isRunning()) {
          console.log('MessageHandler: Starting render loop');
          this.frameRenderer.startRenderLoop();
        }

        console.log('MessageHandler: Shader processing complete');
        return { running: true };
      } finally {
        this.isHandlingMessage = false;
      }
    } catch (err) {
      console.error('MessageHandler: Fatal error in handleShaderMessage:', err);
      console.error('MessageHandler: Error stack:', err instanceof Error ? err.stack : 'No stack');
      console.error('MessageHandler: Event data:', event.data);
      
      this.isHandlingMessage = false;
      
      // Try to send error message, but don't throw if this fails too
      try {
        this.transport.postMessage({
          type: "error",
          payload: [`Fatal shader processing error: ${err}`],
        });
      } catch (transportErr) {
        console.error('MessageHandler: Failed to send error message:', transportErr);
      }
      
      return { running: false };
    }
  }

  public reset(onReset?: () => void): void {
    this.shaderPipeline.cleanup();
    this.timeManager.cleanup();
    
    if (this.lastEvent && onReset) {
      onReset();
    } else {
      this.transport.postMessage({
        type: "error",
        payload: ["❌ No shader to reset"],
      });
    }
  }
}
