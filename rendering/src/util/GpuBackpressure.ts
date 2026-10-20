import { resolveGpuBackpressure, type GpuBackpressureSettings } from "@shader-studio/types";

export interface GpuFrameCompletion {
  /** Nonblocking poll. Throw when completion tracking fails. */
  poll(): boolean;
  dispose(): void;
}

/** Bounds interactive submissions without waiting on the JavaScript thread. */
export class GpuBackpressure {
  private pending: GpuFrameCompletion[] = [];
  private settings = resolveGpuBackpressure();
  private lastProgress = 0;
  private stalled = false;
  private failed = false;

  constructor(private readonly onStall: (message: string) => void) {}

  configure(settings: GpuBackpressureSettings): void {
    this.settings = resolveGpuBackpressure(settings);
  }

  canSubmit(now: number): boolean {
    if (this.failed) {
      return false;
    }
    try {
      while (this.pending[0]?.poll()) {
        this.pending.shift()!.dispose();
        this.lastProgress = now;
        this.stalled = false;
      }
    } catch {
      this.fail("GPU completion tracking failed. Rendering paused; reload the viewer to retry.");
      return false;
    }
    if (this.pending.length > 0 && now - this.lastProgress >= this.settings.stallTimeoutMs) {
      if (!this.stalled) {
        this.stalled = true;
        this.onStall(`GPU stalled for ${this.settings.stallTimeoutMs} ms. Rendering paused; resume after the GPU recovers.`);
      }
      return false;
    }
    return this.pending.length < this.settings.framesInFlight;
  }

  submitted(completion: GpuFrameCompletion, now: number): void {
    if (this.pending.length === 0) {
      this.lastProgress = now;
    }
    this.pending.push(completion);
  }

  fail(message: string): void {
    if (!this.failed) {
      this.failed = true;
      this.onStall(message);
    }
  }

  dispose(): void {
    for (const completion of this.pending) {
      completion.dispose();
    }
    this.pending = [];
    this.stalled = false;
    this.failed = false;
  }
}

export function webglFrameCompletion(gl: WebGL2RenderingContext): GpuFrameCompletion {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) {
    throw new Error("Unable to create a GPU fence");
  }
  gl.flush();
  return {
    poll: () => {
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.WAIT_FAILED) {
        throw new Error("GPU fence wait failed");
      }
      return status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED;
    },
    dispose: () => gl.deleteSync(sync),
  };
}

export function webgpuFrameCompletion(queue: GPUQueue): GpuFrameCompletion {
  let done = false;
  let failed = false;
  let disposed = false;
  void queue.onSubmittedWorkDone().then(() => {
    if (!disposed) {
      done = true;
    }
  }, () => {
    if (!disposed) {
      failed = true;
    }
  });
  return {
    poll: () => {
      if (failed) {
        throw new Error("GPU queue completion failed");
      }
      return done;
    },
    dispose: () => {
      disposed = true;
    },
  };
}
