import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";

export interface PerformanceData {
  currentFPS: number;
  avgFrameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
  frameTimeHistory: number[];
  frameTimeCount: number;
  /** Submit-to-completion latency, where the backend can report it. */
  gpuFrameTime: number | null;
  /** Same indexing as frameTimeHistory: entry i in each is the same frame. */
  gpuFrameTimeHistory: number[];
}

export class PerformanceMonitor {
  private renderingEngine: RenderingEngine;
  private stateCallback: ((data: PerformanceData) => void) | null = null;
  private rafId: number | null = null;
  private running = false;

  constructor(renderingEngine: RenderingEngine) {
    this.renderingEngine = renderingEngine;
  }

  public setStateCallback(callback: (data: PerformanceData) => void): void {
    this.stateCallback = callback;
  }

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    // GPU timing costs nothing while nobody is reading it, so it follows the
    // panel rather than running for every preview.
    this.renderingEngine.setGpuTimingEnabled?.(true);
    this.tick();
  }

  public stop(): void {
    this.running = false;
    this.renderingEngine.setGpuTimingEnabled?.(false);
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public dispose(): void {
    this.stop();
    this.stateCallback = null;
  }

  private tick = (): void => {
    if (!this.running) {
      return;
    }
    this.poll();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private poll(): void {
    if (!this.stateCallback) {
      return;
    }

    const history = this.renderingEngine.getFrameTimeHistory();
    const currentFPS = this.renderingEngine.getCurrentFPS();
    const frameTimeCount = this.renderingEngine.getFrameTimeCount();

    let avg = 0, min = Infinity, max = 0;

    if (history.length > 0) {
      for (const t of history) {
        avg += t;
        if (t < min) {
          min = t;
        }
        if (t > max) {
          max = t;
        }
      }
      avg /= history.length;
    } else {
      min = 0;
    }

    this.stateCallback({
      currentFPS,
      avgFrameTime: avg,
      minFrameTime: min,
      maxFrameTime: max,
      frameTimeHistory: history,
      frameTimeCount,
      gpuFrameTime: this.renderingEngine.getGpuFrameTimeMs?.() ?? null,
      gpuFrameTimeHistory: this.renderingEngine.getGpuFrameTimeHistory?.() ?? [],
    });
  }
}
