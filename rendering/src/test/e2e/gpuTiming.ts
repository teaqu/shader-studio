/**
 * Diagnostics for the intermittent GPU stalls on hosted macOS runners, where
 * readbacks that normally finish in a few milliseconds take seconds. A slow
 * readback is split into the CPU-side render() call and the wait for the GPU,
 * so CI logs show which one the time went to and on which fixture.
 */

/** A readback slower than this is reported. Healthy ones take a few ms. */
export const SLOW_READBACK_MS = 1_000;
/** A compile slower than this is reported. Most corpus fixtures take < 1s. */
export const SLOW_COMPILE_MS = 3_000;

export interface ReadbackTiming {
  label: string;
  language: string;
  requestId: number;
  canvas: string;
  /** Wall time of engine.render(), which encodes and submits the frame. */
  renderMs: number;
  /** From render() returning until the capturer reported "mapping". */
  untilMappingMs: number | null;
  /**
   * From "mapping" until the result was collected (the GPU finishing the
   * frame), or until the mapping failed and the request left that stage.
   */
  mappingMs: number | null;
  totalMs: number;
  /** Readback stage when waiting stopped; "completed" unless it timed out. */
  finalStage: string;
}

export interface CompileTiming {
  label: string;
  language: string;
  compileMs: number;
  /**
   * Which part of a compile was timed, when one is split: e.g. the whole UI
   * "open" (host round trip included) versus its "pipeline" compile alone.
   */
  phase?: string;
}

/**
 * The fixture name a test set explicitly, else the running test's name, so a
 * suite that never labels its harness still says where the time went.
 */
export function resolveLabel(explicit: string | null, currentTestName: string | undefined): string {
  return explicit ?? currentTestName ?? "(unlabelled)";
}

const PREFIX = "[gpu-timing]";

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

/**
 * Splits a readback's wait at the moment it entered the "mapping" stage. A
 * mapping that failed (the request left "mapping" without a result) is timed
 * only until it left, so a fast failure is not mistaken for a slow GPU.
 */
export function splitWait(
  renderEndedAt: number,
  mappingSeenAt: number | null,
  mappingLeftAt: number | null,
  endedAt: number,
): Pick<ReadbackTiming, "untilMappingMs" | "mappingMs"> {
  if (mappingSeenAt === null) {
    return { untilMappingMs: null, mappingMs: null };
  }
  return { untilMappingMs: mappingSeenAt - renderEndedAt, mappingMs: (mappingLeftAt ?? endedAt) - mappingSeenAt };
}

/** The log line for a readback worth reporting, or null for a healthy one. */
export function readbackTimingLine(timing: ReadbackTiming, threshold = SLOW_READBACK_MS): string | null {
  if (timing.totalMs < threshold && timing.finalStage === "completed") {
    return null;
  }
  return `${PREFIX} ${JSON.stringify({
    kind: "readback",
    label: timing.label,
    language: timing.language,
    requestId: timing.requestId,
    canvas: timing.canvas,
    renderMs: round(timing.renderMs),
    untilMappingMs: round(timing.untilMappingMs),
    mappingMs: round(timing.mappingMs),
    totalMs: round(timing.totalMs),
    finalStage: timing.finalStage,
  })}`;
}

/** The log line for a compile worth reporting, or null for a fast one. */
export function compileTimingLine(timing: CompileTiming, threshold = SLOW_COMPILE_MS): string | null {
  if (timing.compileMs < threshold) {
    return null;
  }
  return `${PREFIX} ${JSON.stringify({
    kind: "compile",
    label: timing.label,
    language: timing.language,
    ...(timing.phase ? { phase: timing.phase } : {}),
    compileMs: Math.round(timing.compileMs),
  })}`;
}

/**
 * Pending GPU work is reported once a drain takes this long. After a
 * fixture's last readback completes the queue should already be empty, so
 * anything above a few ms is work nobody waited for.
 */
export const SLOW_DRAIN_MS = 250;

/** The part of a GPUQueue a drain needs, so tests can supply a fake. */
export interface DrainableQueue {
  onSubmittedWorkDone?: () => Promise<unknown>;
}

export interface DrainTiming {
  label: string;
  language: string;
  drainMs: number;
  /**
   * Whether the engine's own animation loop was scheduled when the drain
   * started, or null where that cannot be read (WebGL).
   */
  loopRunning?: boolean | null;
  /** Frames rendered between the harness's last own render and the drain resolving. */
  unrequestedFrames?: number | null;
  /** Queue calls made outside render() since the previous drain, by method. */
  outsideRender?: QueueCallCounts;
}

/**
 * The log line for a drain worth reporting, or null for an idle queue. Frames
 * nobody requested are always worth reporting: they are work the test never
 * asked for, however quickly the GPU got through it.
 */
export function drainTimingLine(timing: DrainTiming, threshold = SLOW_DRAIN_MS): string | null {
  const unrequested = timing.unrequestedFrames ?? 0;
  if (timing.drainMs < threshold && unrequested <= 0) {
    return null;
  }
  const outside = timing.outsideRender && Object.keys(timing.outsideRender).length > 0
    ? { outsideRender: timing.outsideRender }
    : {};
  return `${PREFIX} ${JSON.stringify({
    kind: "drain",
    label: timing.label,
    language: timing.language,
    drainMs: Math.round(timing.drainMs),
    ...(timing.loopRunning === undefined ? {} : { loopRunning: timing.loopRunning }),
    ...(timing.unrequestedFrames === undefined ? {} : { unrequestedFrames: timing.unrequestedFrames }),
    ...outside,
  })}`;
}

/**
 * Times how long the queue takes to finish the work already submitted, without
 * the caller waiting: awaiting it would itself clear a backlog and hide it.
 * `report` runs once the drain resolves; a missing or failing queue reports
 * nothing.
 */
export function watchQueueDrain(
  queue: DrainableQueue | null | undefined,
  report: (drainMs: number) => void,
  now: () => number = () => performance.now(),
): void {
  const done = queue?.onSubmittedWorkDone;
  if (!done) {
    return;
  }
  const startedAt = now();
  let pending: Promise<unknown>;
  try {
    pending = done.call(queue);
  } catch {
    return;
  }
  pending.then(() => report(now() - startedAt), () => { /* device lost: nothing to time */ });
}

/** Queue methods that put work on the GPU, counted when called outside render(). */
export const COUNTED_QUEUE_METHODS = ["submit", "writeBuffer", "writeTexture", "copyExternalImageToTexture"] as const;
export type CountedQueueMethod = (typeof COUNTED_QUEUE_METHODS)[number];
export type QueueCallCounts = Partial<Record<CountedQueueMethod, number>>;

export interface QueueCallCounter {
  /** Calls made outside render() since the last take(), then resets. */
  take(): QueueCallCounts;
}

/**
 * Wraps a queue's work-submitting methods in place so calls made while
 * `inRender()` is false are counted: GPU work the harness never asked a frame
 * for, such as an upload that lands after an async texture load. Each method
 * still forwards to the original with the same `this` and arguments.
 */
export function countQueueCallsOutsideRender(
  queue: Record<string, unknown>,
  inRender: () => boolean,
): QueueCallCounter {
  let counts: QueueCallCounts = {};
  for (const method of COUNTED_QUEUE_METHODS) {
    const original = queue[method];
    if (typeof original !== "function") {
      continue;
    }
    queue[method] = function (this: unknown, ...args: unknown[]) {
      if (!inRender()) {
        counts[method] = (counts[method] ?? 0) + 1;
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
  return {
    take(): QueueCallCounts {
      const taken = counts;
      counts = {};
      return taken;
    },
  };
}
