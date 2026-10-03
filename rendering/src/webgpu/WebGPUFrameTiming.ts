import {
  gpuBackpressureEnabled,
  MAX_FRAMES_IN_FLIGHT,
  MAX_GPU_STALL_MS,
} from "../util/GpuBackpressure";
import { TimeManager } from "../util/TimeManager";
import type { WebGPUCompileDiagnostics } from "./WebGPUCompileDiagnostics";

interface WebGPUFrameTimingHost {
  diagnostics: WebGPUCompileDiagnostics;
  running: boolean;
  device: GPUDevice | null;
  disposed: boolean;
  timeManager: TimeManager;
}

/** Owns timing state and operations; dependencies stay live across compilation swaps. */
export class WebGPUFrameTiming {
  constructor(private readonly host: WebGPUFrameTimingHost) {}

  fpsLimit = 0;

  lastRenderedAt: number | null = null;

  frameTimeBuffer: number[] = new Array(3600);

  gpuFrameTimeBuffer: number[] = new Array(3600);

  frameTimeHead = 0;

  frameTimeLen = 0;

  frameTimeCount = 0;

  previousFrameTimestamp: number | null = null;

  gpuTimingEnabled = false;

  gpuFrameMs: number | null = null;

  framesInFlight = 0;

  gpuStallStartMs: number | null = null;

  gpuProbeInFlight = false;

  shouldWaitForGpu(time: number): boolean {
    if (!gpuBackpressureEnabled() || !this.host.running) {
      this.gpuStallStartMs = null;
      return false;
    }
    if (this.framesInFlight < MAX_FRAMES_IN_FLIGHT) {
      this.gpuStallStartMs = null;
      return false;
    }
    if (this.gpuStallStartMs === null) {
      this.gpuStallStartMs = time;
    }
    if (time - this.gpuStallStartMs >= MAX_GPU_STALL_MS) {
      this.gpuStallStartMs = null;
      return false;
    }
    return true;
  }

  trackFrameInFlight(): void {
    if (!gpuBackpressureEnabled() || !this.host.device?.queue?.onSubmittedWorkDone) {
      return;
    }
    this.framesInFlight += 1;
    let completion: Promise<void>;
    try {
      completion = this.host.device.queue.onSubmittedWorkDone();
    } catch {
      this.framesInFlight = Math.max(0, this.framesInFlight - 1);
      return;
    }
    const release = () => {
      this.framesInFlight = Math.max(0, this.framesInFlight - 1);
    };
    void completion.then(release, release);
  }

  getGpuFrameTimeMs(): number | null {
    return this.gpuFrameMs;
  }

  setGpuTimingEnabled(enabled: boolean): void {
    this.gpuTimingEnabled = enabled;
    if (!enabled) {
      this.gpuFrameMs = null;
    }
  }

  probeGpuFrameTime(): void {
    if (!this.gpuTimingEnabled || this.gpuProbeInFlight || !this.host.device?.queue?.onSubmittedWorkDone) {
      return;
    }
    const submittedAt = this.host.diagnostics.now();
    this.gpuProbeInFlight = true;
    let completion: Promise<void>;
    try {
      completion = this.host.device.queue.onSubmittedWorkDone();
    } catch {
      this.gpuProbeInFlight = false;
      return;
    }
    void completion.then(
      () => {
        this.gpuProbeInFlight = false;
        if (!this.host.disposed) {
          this.gpuFrameMs = this.host.diagnostics.ms(this.host.diagnostics.now() - submittedAt);
        }
      },
      () => {
        this.gpuProbeInFlight = false;
      },
    );
  }

  shouldRenderFrame(time: number): boolean {
    if (this.fpsLimit > 0 && this.lastRenderedAt !== null) {
      const minFrameInterval = 1000 / this.fpsLimit;
      const elapsed = time - this.lastRenderedAt;
      if (elapsed < minFrameInterval * 0.9) {
        return false;
      }

      this.lastRenderedAt += minFrameInterval;
      if (this.lastRenderedAt < time - minFrameInterval) {
        this.lastRenderedAt = time;
      }
      return true;
    }

    this.lastRenderedAt = time;
    return true;
  }

  recordFrameTime(time: number): void {
    if (this.host.timeManager.isPaused()) {
      this.previousFrameTimestamp = null;
      return;
    }

    if (this.previousFrameTimestamp !== null) {
      const frameDelta = time - this.previousFrameTimestamp;
      // A gap this large is almost always the tab being backgrounded rather
      // than one real slow frame, but guessing that from magnitude alone
      // means genuinely sustained slowness gets silently discarded too.
      // Only a non-positive delta is degenerate; resetFrameTimeHistory()
      // is the deliberate way to clear a backgrounding artifact.
      if (frameDelta > 0) {
        this.frameTimeBuffer[this.frameTimeHead] = frameDelta;
        this.gpuFrameTimeBuffer[this.frameTimeHead] = this.gpuFrameMs ?? 0;
        this.frameTimeHead = (this.frameTimeHead + 1) % 3600;
        if (this.frameTimeLen < 3600) {
          this.frameTimeLen++;
        }
        this.frameTimeCount++;
      }
    }
    this.previousFrameTimestamp = time;
  }

  getFrameTimeHistory(): number[] {
    if (this.frameTimeLen === 0) {
      return [];
    }
    const start = (
      this.frameTimeHead - this.frameTimeLen + 3600
    ) % 3600;
    if (start + this.frameTimeLen <= 3600) {
      return this.frameTimeBuffer.slice(start, start + this.frameTimeLen);
    }
    return this.frameTimeBuffer.slice(start).concat(this.frameTimeBuffer.slice(0, this.frameTimeHead));
  }

  getGpuFrameTimeHistory(): number[] {
    if (this.frameTimeLen === 0) {
      return [];
    }
    const start = (
      this.frameTimeHead - this.frameTimeLen + 3600
    ) % 3600;
    if (start + this.frameTimeLen <= 3600) {
      return this.gpuFrameTimeBuffer.slice(start, start + this.frameTimeLen);
    }
    return this.gpuFrameTimeBuffer.slice(start).concat(this.gpuFrameTimeBuffer.slice(0, this.frameTimeHead));
  }

  getFrameTimeCount(): number {
    return this.frameTimeCount;
  }

  setFPSLimit(limit: number): void {
    this.fpsLimit = limit;
    this.lastRenderedAt = null;
  }
}
