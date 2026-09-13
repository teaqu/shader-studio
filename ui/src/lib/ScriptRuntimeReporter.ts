import type { RenderingEngine } from "../../../rendering/src/types/RenderingEngine";

interface Transport {
  postMessage(message: unknown): void;
}

export interface ScriptRuntimeState {
  paused: boolean;
  time: number;
  frame: number;
  frameRate: number;
  resolution: [number, number, number];
  mouse: [number, number, number, number];
  channelTimes: number[];
  sampleRate: number;
}

/** How often the viewer looks for something the host could not have predicted. */
const SAMPLE_INTERVAL_MS = 250;

/**
 * Minimum gap between reports. Mouse moves and resizes call sync() at input
 * frequency; without this the reporter would post a message per mousemove.
 */
const SYNC_THROTTLE_MS = 50;

/**
 * The host holds channel clocks between reports because media can pause, loop,
 * or play at a different rate. Refresh after this much change, so playback
 * stays current without sending every frame; seeks are reported too.
 */
const CHANNEL_TIME_TOLERANCE_SECONDS = 0.25;

/**
 * Shader time the host predicts on its own drifts by the sample interval at
 * worst; anything beyond that is a scrub, a reset, or a speed change.
 */
const TIME_DRIFT_TOLERANCE_SECONDS = 0.5;

// Ignore small timing noise, but update the host when the render cadence
// changes. Its frame counter is extrapolated from the last reported FPS.
const FRAME_RATE_TOLERANCE = 1;

/**
 * Tells the extension host what the viewer is showing, because that is where
 * uniform scripts run. Without it the host invents a context from wall clock -
 * `ctx.iTime` marches on through a pause, `iResolution` is a fixed 800x600, and
 * `iMouse` is always zero.
 *
 * Reports are event-shaped rather than per-frame: the host carries time forward
 * itself between them. A steady shader with unchanged media clocks is quiet;
 * playing media gets periodic channel-clock updates.
 */
export class ScriptRuntimeReporter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReported: ScriptRuntimeState | null = null;
  private lastReportedAt = 0;

  constructor(
    private readonly engine: Partial<Pick<
      RenderingEngine,
      "getTimeManager" | "getCurrentFPS" | "getMouse" | "getCanvas"
      | "getChannelTimes" | "getAudioSampleRate"
    >>,
    private readonly transport: Transport,
  ) {}

  public start(): void {
    this.stopTimer();
    this.sync();
    this.timer = setInterval(() => this.sync(), SAMPLE_INTERVAL_MS);
  }

  /** Report now - used where the viewer already knows something changed. */
  public sync(): void {
    const state = this.read();
    if (!this.worthReporting(state)) {
      return;
    }
    if (this.lastReported !== null && Date.now() - this.lastReportedAt < SYNC_THROTTLE_MS) {
      // Inside the throttle window: defer to a flush at the window's end,
      // which re-reads, so a burst reports once with the latest state.
      if (this.throttleTimer === null) {
        const wait = SYNC_THROTTLE_MS - (Date.now() - this.lastReportedAt);
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          this.sync();
        }, wait);
      }
      return;
    }
    this.lastReported = state;
    this.lastReportedAt = Date.now();
    this.transport.postMessage({ type: "scriptRuntimeState", payload: state });
  }

  public dispose(): void {
    this.stopTimer();
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.lastReported = null;
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Every reading is optional-called: this reports on the viewer's state, and
   * an engine that cannot answer one question is not a reason to fail the
   * viewer's startup. A missing answer means the script sees a zero, which is
   * what it saw before any of this existed.
   */
  private read(): ScriptRuntimeState {
    const timeManager = this.engine.getTimeManager?.();
    const canvas = this.engine.getCanvas?.();
    const width = canvas?.width ?? 0;
    const height = canvas?.height ?? 0;
    const mouse = this.engine.getMouse?.() ?? [0, 0, 0, 0];
    return {
      paused: timeManager?.isPaused?.() ?? false,
      time: timeManager?.getCurrentTime?.(performance.now()) ?? 0,
      frame: timeManager?.getFrame?.() ?? 0,
      frameRate: this.engine.getCurrentFPS?.() ?? 0,
      resolution: [width, height, height > 0 ? width / height : 0],
      mouse: [mouse[0] ?? 0, mouse[1] ?? 0, mouse[2] ?? 0, mouse[3] ?? 0],
      channelTimes: this.engine.getChannelTimes?.() ?? [0, 0, 0, 0],
      // Matches the engines' own fallback, so a script never sees a rate of
      // zero it would have to guard against.
      sampleRate: this.engine.getAudioSampleRate?.() ?? 44100,
    };
  }

  /**
   * The host advances shader time between reports, but needs updates for
   * channel clocks and other inputs it cannot predict.
   */
  private worthReporting(state: ScriptRuntimeState): boolean {
    const previous = this.lastReported;
    if (!previous) {
      return true;
    }
    if (state.paused !== previous.paused) {
      return true;
    }
    if (!sameNumbers(state.resolution, previous.resolution)
      || !sameNumbers(state.mouse, previous.mouse)) {
      return true;
    }
    if (state.sampleRate !== previous.sampleRate) {
      return true;
    }
    if (!sameChannelTimes(state.channelTimes, previous.channelTimes)) {
      return true;
    }

    const elapsed = previous.paused ? 0 : (Date.now() - this.lastReportedAt) / 1000;
    const predicted = previous.time + elapsed;
    const predictedFrame = previous.frame + Math.floor(elapsed * (previous.frameRate > 0 ? previous.frameRate : 30));
    const frameTolerance = previous.paused ? 0 : Math.max(2, previous.frameRate * TIME_DRIFT_TOLERANCE_SECONDS);
    return Math.abs(state.time - predicted) > TIME_DRIFT_TOLERANCE_SECONDS
      || Math.abs(state.frameRate - previous.frameRate) > FRAME_RATE_TOLERANCE
      || Math.abs(state.frame - predictedFrame) > frameTolerance;
  }
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameChannelTimes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length
    && a.every((value, index) => Math.abs(value - b[index]) <= CHANNEL_TIME_TOLERANCE_SECONDS);
}
