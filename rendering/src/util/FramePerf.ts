/**
 * Temporary in-app instrumentation for comparing the WebGL and WebGPU engines
 * in the environment a user actually runs them in (VS Code webview, Electron),
 * where a harness cannot follow: which GPU adapter the host handed us, how big
 * the canvas backing store really is, and what frame rate each engine reaches.
 *
 * Enable with `window.__shaderPerf = true` before the preview loads, or at any
 * time from the webview devtools — the flag is read per call. Remove this file
 * once the question it was added for is answered.
 */
export function framePerfEnabled(): boolean {
  return (globalThis as typeof globalThis & { __shaderPerf?: boolean }).__shaderPerf === true;
}

function log(event: string, data: Record<string, unknown>): void {
  if (!framePerfEnabled()) {
    return;
  }
  // Serialized rather than logged as an object: a devtools console collapses
  // object payloads behind an ellipsis, and these lines exist to be pasted.
  console.log(`[ShaderPerf] ${event} ${JSON.stringify(data)}`);
}

/** Canvas geometry the app derives from zoom, resolution scale and DPR. */
export function describeCanvas(canvas: HTMLCanvasElement | null): Record<string, unknown> {
  if (!canvas) {
    return { canvas: null };
  }
  return {
    backingWidth: canvas.width,
    backingHeight: canvas.height,
    backingPixels: canvas.width * canvas.height,
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
    devicePixelRatio: typeof devicePixelRatio === "number" ? devicePixelRatio : null,
  };
}

/**
 * JS heap size, where the host exposes it (Chromium only, and unavailable when
 * the page is cross-origin isolated). A heap that falls between reports is a
 * collection, which is the shape a stall between frame callbacks would take.
 */
function heapMB(): number | null {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  const used = memory?.usedJSHeapSize;
  return typeof used === "number" ? Number((used / (1024 * 1024)).toFixed(1)) : null;
}

export function logFramePerfInit(engine: string, data: Record<string, unknown>): void {
  log(`${engine} init`, data);
}

const FRAMES_PER_REPORT = 120;

/**
 * Aggregates per-frame CPU cost and achieved frame rate, reporting once per
 * window rather than per frame so the log stays readable during a drag.
 */
export class FramePerfTracker {
  private static nextInstance = 1;

  private readonly instance = FramePerfTracker.nextInstance++;
  private samples: number[] = [];
  private intervals: number[] = [];
  private lastFrameAt: number | null = null;
  private windowStartedAt: number | null = null;

  constructor(private readonly engine: string) {}

  /** Records one frame's main-thread cost, in milliseconds. */
  record(frameMs: number, context: () => Record<string, unknown>): void {
    if (!framePerfEnabled()) {
      if (this.samples.length > 0) {
        this.reset(null);
      }
      return;
    }
    const now = performance.now();
    this.windowStartedAt ??= now;
    // Average frame rate hides judder: a stream of 8ms frames punctuated by
    // 40ms ones averages out, but is what a viewer perceives as stuttering.
    if (this.lastFrameAt !== null) {
      this.intervals.push(now - this.lastFrameAt);
    }
    this.lastFrameAt = now;
    this.samples.push(frameMs);
    if (this.samples.length < FRAMES_PER_REPORT) {
      return;
    }
    const elapsed = Math.max(now - this.windowStartedAt, 0.01);
    const sorted = [...this.samples].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    const gaps = [...this.intervals].sort((a, b) => a - b);
    const medianGap = percentile(gaps, 0.5);
    // A frame taking half again as long as the median is a visible hitch.
    const hitches = gaps.filter((gap) => medianGap > 0 && gap > medianGap * 1.5).length;
    log(`${this.engine} frames`, {
      // Two engines logging at once means two live previews sharing the GPU.
      instance: this.instance,
      fps: round((this.samples.length / elapsed) * 1000),
      cpuMsAvg: round(total / sorted.length),
      cpuMsP50: round(sorted[Math.floor(sorted.length * 0.5)]!),
      cpuMsP95: round(sorted[Math.floor(sorted.length * 0.95)]!),
      cpuMsMax: round(sorted[sorted.length - 1]!),
      gapMsP50: round(medianGap),
      gapMsP95: round(percentile(gaps, 0.95)),
      gapMsMax: round(gaps[gaps.length - 1] ?? 0),
      hitches,
      heapMB: heapMB(),
      ...context(),
    });
    this.reset(now);
  }

  private reset(windowStartedAt: number | null): void {
    this.samples = [];
    this.intervals = [];
    this.lastFrameAt = null;
    this.windowStartedAt = windowStartedAt;
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
