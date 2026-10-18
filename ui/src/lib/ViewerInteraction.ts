import { keyCodeForCode, type RenderingEngineInterface as RenderingEngine, type ViewerInputEvent, type ViewerInputSource } from '@shader-studio/rendering';

export interface InputTraceEvent {
  sequence: number;
  /** Seconds of wall time since recording began, independent of playback speed. */
  time: number;
  frame: number;
  source: ViewerInputSource;
  event: ViewerInputEvent;
}
export interface InputTrace {
  id: string;
  path: string;
  compileSequence: number | null;
  initial: { time: number; frame: number; paused: boolean; heldCodes: string[] };
  events: InputTraceEvent[];
  stopped: boolean;
  truncated: boolean;
}
export type ReplayStatus = 'idle' | 'scheduled' | 'running' | 'completed' | 'cancelled' | 'failed';

type InputEngine = Pick<RenderingEngine, 'injectInput' | 'subscribeInput'> & {
  getTimeManager(): Pick<ReturnType<RenderingEngine['getTimeManager']>, 'getCurrentTime' | 'getFrame' | 'isPaused'>;
};

/** Records live inputs; replay never reconstructs a previously captured GPU state. */
export class ViewerInteraction {
  private trace: InputTrace | null = null;
  private subscription: { dispose(): void } | null = null;
  private traceTimer?: ReturnType<typeof setTimeout>;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private status: ReplayStatus = 'idle';
  private generation = 0;

  constructor(
    private readonly engine: InputEngine,
    private readonly context: () => { path: string; compileSequence: number | null; reset(): Promise<void> | void },
  ) {}

  start(): InputTrace {
    this.stop();
    const tm = this.engine.getTimeManager();
    const current = this.context();
    const input = this.engine.injectInput([]);
    this.trace = {
      id: crypto.randomUUID(), path: current.path, compileSequence: current.compileSequence,
      initial: { time: tm.getCurrentTime(performance.now()), frame: tm.getFrame(), paused: tm.isPaused(), heldCodes: [...input.heldCodes] },
      events: [], stopped: false, truncated: false,
    };
    const wallStart = performance.now();
    this.subscription = this.engine.subscribeInput((event, source) => {
      if (!this.trace || !validEvent(event)) {
        return;
      }
      if (this.context().path !== current.path || this.context().compileSequence !== current.compileSequence) {
        this.stop();
        return;
      }
      const elapsed = (performance.now() - wallStart) / 1000;
      if (this.trace.events.length >= 256 || elapsed > 60) {
        this.trace.truncated = true;
        this.stop();
        return;
      }
      this.trace.events.push({ sequence: this.trace.events.length, time: elapsed, frame: tm.getFrame(), source, event: structuredClone(event) });
    });
    this.traceTimer = setTimeout(() => {
      if (this.trace) {
        this.trace.truncated = true;
      }
      this.stop();
    }, 60_000);
    return structuredClone(this.trace);
  }

  stop(): InputTrace | null {
    clearTimeout(this.traceTimer);
    this.subscription?.dispose();
    this.subscription = null;
    if (this.trace) {
      this.trace.stopped = true;
    }
    return this.get();
  }

  get(): InputTrace | null {
    return this.trace && structuredClone(this.trace);
  }

  inject(events: readonly ViewerInputEvent[]) {
    if (!Array.isArray(events) || events.length > 256 || !events.every(validEvent)) {
      throw new Error('Invalid input event batch: provide at most 256 canonical input events.');
    }
    return this.engine.injectInput(events);
  }

  async replay(trace: InputTrace, mode: 'from-current' | 'reset-and-play'): Promise<void> {
    if (mode !== 'from-current' && mode !== 'reset-and-play') {
      throw new Error('Unsupported replay mode.');
    }
    if (!trace || !Array.isArray(trace.events) || trace.events.length > 256 || !trace.events.every(item => item
      && Number.isFinite(item.time) && item.time >= 0 && item.time <= 60 && validEvent(item.event))) {
      throw new Error('Trace contains invalid input events.');
    }
    // Freeze the trace before reset/replay can emit input events into a recorder.
    const events = structuredClone(trace.events);
    this.stop();
    this.cancel();
    const generation = ++this.generation;
    this.status = 'scheduled';
    const before = this.context();
    if (before.path !== trace.path || before.compileSequence !== trace.compileSequence) {
      this.status = 'failed';
      throw new Error('Preview changed since the trace was recorded.');
    }
    try {
      if (mode === 'reset-and-play') {
        await before.reset();
      }
    } catch (error) {
      if (generation === this.generation) {
        this.status = 'failed';
      }
      throw error;
    }
    if (generation !== this.generation) {
      return;
    }
    const current = this.context();
    if (current.path !== before.path) {
      this.status = 'failed';
      throw new Error('Preview switched while resetting.');
    }
    this.status = 'running';
    for (const item of events) {
      this.schedule(item.time * 1000, () => {
        const now = this.context();
        if (now.path !== current.path || now.compileSequence !== current.compileSequence) {
          throw new Error('Preview changed during replay.');
        }
        this.engine.injectInput([item.event]);
      }, generation);
    }
    const duration = Math.max(0, ...events.map(event => event.time * 1000));
    this.schedule(duration + 1, () => {
      this.engine.injectInput([{ type: 'release_all' }]);
      this.status = 'completed';
    }, generation);
  }

  replayStatus(): ReplayStatus {
    return this.status;
  }

  cancel(): void {
    ++this.generation;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.engine.injectInput([{ type: 'release_all' }]);
    if (this.status === 'running' || this.status === 'scheduled') {
      this.status = 'cancelled';
    }
  }

  dispose(): void {
    this.cancel();
    this.stop();
  }

  private schedule(delay: number, apply: () => void, generation: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (generation !== this.generation) {
        return;
      }
      try {
        apply();
      } catch {
        this.cancel();
        this.status = 'failed';
      }
    }, delay);
    this.timers.add(timer);
  }
}

function validEvent(event: ViewerInputEvent): boolean {
  if (!event || typeof event !== 'object') {
    return false;
  }
  if (event.type === 'release_all') {
    return true;
  }
  if (event.type === 'key_down' || event.type === 'key_up') {
    return typeof event.code === 'string' && keyCodeForCode(event.code) !== undefined;
  }
  if (event.type !== 'pointer_move' && event.type !== 'pointer_down' && event.type !== 'pointer_up') {
    return false;
  }
  return event.type === 'pointer_up' && event.x === undefined && event.y === undefined
    || Number.isFinite(event.x) && Number.isFinite(event.y);
}
