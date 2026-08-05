import type { RenderingEngine } from '../../../rendering/src/types';
import { PIXEL_INSPECTOR_REGION_SIZE, type PixelRegionResult } from '../../../rendering/src/types';
import type { TimeManager } from '../../../rendering/src/util/TimeManager';
import type { PixelInspectorState } from './types/PixelInspectorState';

const READ_INTERVAL_MS = 1000 / 30;
const EMPTY_SNAPSHOT = { pixelRGB: null, fragCoord: null, canvasPosition: null, region: null } as const;

export class PixelInspectorManager {
  private state: PixelInspectorState = {
    isEnabled: false, isActive: false, isLocked: false, mouseX: 0, mouseY: 0,
    ...EMPTY_SNAPSHOT,
  };
  private continuousUpdateHandle: number | null = null;
  private renderingEngine: RenderingEngine | null = null;
  private timeManager: TimeManager | null = null;
  private glCanvas: HTMLCanvasElement | null = null;
  private stateUpdateCallback: ((state: PixelInspectorState) => void) | null;
  private desiredCanvasPosition: { x: number; y: number } | null = null;
  private nextRequestId = 1;
  private minimumAcceptedRequestId = 1;
  private lastAcceptedRequestId = 0;
  private lastRequestTime = -Infinity;

  constructor(stateUpdateCallback?: (state: PixelInspectorState) => void) {
    this.stateUpdateCallback = stateUpdateCallback ?? null;
  }

  public initialize(renderingEngine: RenderingEngine, timeManager: TimeManager, glCanvas: HTMLCanvasElement): void {
    const replacingSession = this.renderingEngine !== renderingEngine || this.glCanvas !== glCanvas;
    if (replacingSession) {
      this.invalidatePending(this.renderingEngine);
      this.desiredCanvasPosition = null;
      this.lastRequestTime = -Infinity;
      this.clearSnapshot();
    }
    this.renderingEngine = renderingEngine;
    this.timeManager = timeManager;
    this.glCanvas = glCanvas;
    if (this.state.isEnabled) {
      this.state.isActive = true;
      this.startContinuousUpdate();
      this.notifyStateChange();
    }
  }

  public getState(): PixelInspectorState {
    return { ...this.state };
  }

  public setEnabled(enabled: boolean): void {
    if (this.state.isEnabled === enabled) {
      return;
    }
    this.state.isEnabled = enabled;
    if (enabled) {
      this.state.isActive = true;
      this.lastRequestTime = -Infinity;
      this.startContinuousUpdate();
    } else {
      this.state.isActive = false;
      this.state.isLocked = false;
      this.desiredCanvasPosition = null;
      this.invalidatePending();
      this.clearSnapshot();
      this.stopContinuousUpdate();
    }
    this.notifyStateChange();
  }

  public toggleEnabled(): void {
    this.setEnabled(!this.state.isEnabled);
  }

  public lockToPosition(canvasX: number, canvasY: number): void {
    if (!this.state.isEnabled || !this.state.isActive) {
      return;
    }
    this.desiredCanvasPosition = { x: Math.floor(canvasX), y: Math.floor(canvasY) };
    this.state.isLocked = true;
    this.notifyStateChange();
  }

  public handleCanvasClick(): void {
    if (!this.state.isActive) {
      return;
    }
    this.state.isLocked = !this.state.isLocked;
    this.notifyStateChange();
  }

  public handleMouseMove(event: MouseEvent): void {
    if (!this.state.isActive || !this.glCanvas || this.state.isLocked) {
      return;
    }
    this.state.mouseX = event.clientX;
    this.state.mouseY = event.clientY;
    const rect = this.glCanvas.getBoundingClientRect();
    const canvasX = ((event.clientX - rect.left) / rect.width) * this.glCanvas.width;
    const canvasY = ((event.clientY - rect.top) / rect.height) * this.glCanvas.height;
    if (canvasX >= 0 && canvasX < this.glCanvas.width && canvasY >= 0 && canvasY < this.glCanvas.height) {
      this.desiredCanvasPosition = { x: Math.floor(canvasX), y: Math.floor(canvasY) };
    } else {
      this.desiredCanvasPosition = null;
      this.invalidatePending();
      this.clearSnapshot();
    }
    this.notifyStateChange();
  }

  private startContinuousUpdate(): void {
    if (this.continuousUpdateHandle !== null) {
      return;
    }
    const update = (timestamp: number) => {
      this.continuousUpdateHandle = null;
      try {
        this.collectCompletedRegions();
        if (this.state.isActive && this.desiredCanvasPosition && timestamp - this.lastRequestTime >= READ_INTERVAL_MS) {
          this.queueRegionRead(timestamp);
        }
      } finally {
        if (this.state.isActive && this.continuousUpdateHandle === null) {
          this.continuousUpdateHandle = requestAnimationFrame(update);
        }
      }
    };
    this.continuousUpdateHandle = requestAnimationFrame(update);
  }

  private queueRegionRead(timestamp: number): void {
    if (!this.renderingEngine || !this.desiredCanvasPosition) {
      return;
    }
    const requestId = this.nextRequestId++;
    try {
      const queued = this.renderingEngine.requestPixelRegion(requestId, this.desiredCanvasPosition.x, this.desiredCanvasPosition.y);
      if (!queued) {
        return;
      }
      this.lastRequestTime = timestamp;
      if (this.timeManager?.isPaused()) {
        this.renderingEngine.render();
      }
    } catch {
      // A failed asynchronous capture must leave the last complete snapshot visible.
    }
  }

  private collectCompletedRegions(): void {
    if (!this.renderingEngine) {
      return;
    }
    let results: unknown;
    try {
      results = this.renderingEngine.collectPixelRegionResults();
    } catch {
      return;
    }
    if (!Array.isArray(results)) {
      return;
    }
    const newest = results
      .filter((result) => this.isValidResult(result) && result.requestId >= this.minimumAcceptedRequestId && result.requestId > this.lastAcceptedRequestId)
      .sort((a, b) => b.requestId - a.requestId)[0];
    if (!newest || !this.glCanvas) {
      return;
    }
    const center = ((PIXEL_INSPECTOR_REGION_SIZE / 2) * PIXEL_INSPECTOR_REGION_SIZE + PIXEL_INSPECTOR_REGION_SIZE / 2) * 4;
    this.lastAcceptedRequestId = newest.requestId;
    this.state.region = { width: newest.width, height: newest.height, rgba: newest.rgba };
    this.state.pixelRGB = { r: newest.rgba[center], g: newest.rgba[center + 1], b: newest.rgba[center + 2] };
    this.state.canvasPosition = { x: newest.centerX, y: newest.centerY };
    this.state.fragCoord = { x: newest.centerX, y: this.glCanvas.height - newest.centerY };
    this.notifyStateChange();
  }

  private isValidResult(result: unknown): result is PixelRegionResult {
    if (typeof result !== 'object' || result === null) {
      return false;
    }
    const candidate = result as Partial<PixelRegionResult>;
    return Number.isSafeInteger(candidate.requestId)
      && (candidate.requestId ?? 0) > 0
      && (candidate.requestId ?? Infinity) < this.nextRequestId
      && Number.isSafeInteger(candidate.centerX)
      && Number.isSafeInteger(candidate.centerY)
      && candidate.width === PIXEL_INSPECTOR_REGION_SIZE
      && candidate.height === PIXEL_INSPECTOR_REGION_SIZE
      && candidate.rgba instanceof Uint8ClampedArray
      && candidate.rgba.length === PIXEL_INSPECTOR_REGION_SIZE * PIXEL_INSPECTOR_REGION_SIZE * 4;
  }

  private invalidatePending(engine = this.renderingEngine): void {
    this.minimumAcceptedRequestId = this.nextRequestId;
    try {
      engine?.cancelPixelRegionRequests();
    } catch { /* Cleanup remains best-effort. */ }
  }

  private clearSnapshot(): void {
    Object.assign(this.state, EMPTY_SNAPSHOT);
  }

  private stopContinuousUpdate(): void {
    if (this.continuousUpdateHandle !== null) {
      cancelAnimationFrame(this.continuousUpdateHandle);
    }
    this.continuousUpdateHandle = null;
  }

  private notifyStateChange(): void {
    this.stateUpdateCallback?.(this.getState());
  }

  public dispose(): void {
    this.invalidatePending();
    this.stopContinuousUpdate();
    this.desiredCanvasPosition = null;
    this.state.isActive = false;
    this.state.isLocked = false;
    this.clearSnapshot();
    this.renderingEngine = null;
    this.timeManager = null;
    this.glCanvas = null;
    this.notifyStateChange();
  }
}
