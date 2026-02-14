import type { RenderingEngine } from "../../../rendering/src/types";
import type { TimeManager } from "../../../rendering/src/util/TimeManager";
import type { PixelInspectorState } from "./types/PixelInspectorState";

export class PixelInspectorManager {
  private state: PixelInspectorState = {
    isEnabled: false,
    isActive: false,
    isLocked: false,
    mouseX: 0,
    mouseY: 0,
    pixelRGB: null,
    fragCoord: null,
    canvasPosition: null,
  };

  private pendingPixelRead: number | null = null;
  private continuousUpdateHandle: number | null = null;
  private renderingEngine: RenderingEngine | null = null;
  private timeManager: TimeManager | null = null;
  private glCanvas: HTMLCanvasElement | null = null;
  private stateUpdateCallback: ((state: PixelInspectorState) => void) | null = null;
  private lastCanvasPosition: { x: number; y: number } | null = null;
  private lastReadTime: number = 0;
  private readonly READ_THROTTLE_MS = 100; // ~10fps - good balance between responsiveness and performance

  constructor(stateUpdateCallback?: (state: PixelInspectorState) => void) {
    this.stateUpdateCallback = stateUpdateCallback || null;
  }

  public initialize(
    renderingEngine: RenderingEngine,
    timeManager: TimeManager,
    glCanvas: HTMLCanvasElement
  ): void {
    this.renderingEngine = renderingEngine;
    this.timeManager = timeManager;
    this.glCanvas = glCanvas;
  }

  public getState(): PixelInspectorState {
    return { ...this.state };
  }

  public toggleEnabled(): void {
    this.state.isEnabled = !this.state.isEnabled;

    if (this.state.isEnabled) {
      this.state.isActive = true;
      this.startContinuousUpdate();
    } else {
      this.state.isActive = false;
      this.state.isLocked = false;
      this.state.pixelRGB = null;
      this.state.fragCoord = null;
      this.state.canvasPosition = null;
      this.cancelPendingRead();
      this.stopContinuousUpdate();
    }

    this.notifyStateChange();
  }

  public handleCanvasClick(): void {
    if (!this.state.isActive) return;

    // Toggle lock state
    this.state.isLocked = !this.state.isLocked;

    // Keep continuous updates running in both locked and unlocked states
    // When locked: position stays frozen but pixel color keeps updating
    // When unlocked: both position and color update
    this.notifyStateChange();
  }

  public handleMouseMove(event: MouseEvent): void {
    if (
      !this.state.isActive ||
      !this.glCanvas ||
      this.state.isLocked
    ) {
      return;
    }

    // Update mouse position immediately (for smooth UI following)
    this.state.mouseX = event.clientX;
    this.state.mouseY = event.clientY;

    const rect = this.glCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * this.glCanvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * this.glCanvas.height;

    // Check if mouse is within canvas bounds
    if (
      canvasX >= 0 &&
      canvasX < this.glCanvas.width &&
      canvasY >= 0 &&
      canvasY < this.glCanvas.height
    ) {
      // Store the canvas position for continuous updates (throttled pixel reading)
      this.lastCanvasPosition = { x: canvasX, y: canvasY };
    } else {
      this.lastCanvasPosition = null;
      this.state.pixelRGB = null;
      this.state.fragCoord = null;
      this.state.canvasPosition = null;
    }

    // Always notify state change immediately for smooth mouse position updates
    this.notifyStateChange();
  }

  private readPixelAtPosition(canvasX: number, canvasY: number): void {
    if (!this.glCanvas || !this.renderingEngine) return;

    const pixel = this.renderingEngine.readPixel(
      Math.floor(canvasX),
      Math.floor(canvasY)
    );

    if (pixel) {
      this.state.pixelRGB = { r: pixel.r, g: pixel.g, b: pixel.b };
      this.state.fragCoord = {
        x: canvasX,
        y: this.glCanvas.height - canvasY,
      };
      this.state.canvasPosition = {
        x: canvasX,
        y: canvasY,
      };
    } else {
      this.state.pixelRGB = null;
      this.state.fragCoord = null;
      this.state.canvasPosition = null;
    }

    this.notifyStateChange();
  }

  private startContinuousUpdate(): void {
    if (this.continuousUpdateHandle !== null) {
      return; // Already running
    }

    const update = (timestamp: number) => {
      // Only read pixels if inspector is active and we have a position
      // (works for both locked and unlocked states)
      if (this.state.isActive && this.lastCanvasPosition) {
        // Throttle reads to reduce GPU readback overhead
        const timeSinceLastRead = timestamp - this.lastReadTime;
        if (timeSinceLastRead >= this.READ_THROTTLE_MS) {
          // Check if we need to render (when paused)
          if (this.timeManager && this.timeManager.isPaused() && this.renderingEngine) {
            this.renderingEngine.render();
          }

          // Read pixel at the current position (locked or unlocked)
          this.readPixelAtPosition(this.lastCanvasPosition.x, this.lastCanvasPosition.y);
          this.lastReadTime = timestamp;
        }
      }

      // Always schedule next update (even if we didn't read a pixel this frame)
      this.continuousUpdateHandle = requestAnimationFrame(update);
    };

    this.continuousUpdateHandle = requestAnimationFrame(update);
  }

  private stopContinuousUpdate(): void {
    if (this.continuousUpdateHandle !== null) {
      cancelAnimationFrame(this.continuousUpdateHandle);
      this.continuousUpdateHandle = null;
    }
  }

  private cancelPendingRead(): void {
    if (this.pendingPixelRead !== null) {
      cancelAnimationFrame(this.pendingPixelRead);
      this.pendingPixelRead = null;
    }
  }

  private notifyStateChange(): void {
    if (this.stateUpdateCallback) {
      this.stateUpdateCallback(this.getState());
    }
  }

  public dispose(): void {
    this.stopContinuousUpdate();
    this.cancelPendingRead();
    this.renderingEngine = null;
    this.timeManager = null;
    this.glCanvas = null;
  }
}
