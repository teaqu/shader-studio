import type { ViewerSnapshot } from '@shader-studio/types';

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_JOBS = 3;

export interface ViewerFrameCaptureHost {
  snapshot(): ViewerSnapshot;
  captureFrame(): Promise<ImageData>;
  reset(): Promise<void>;
}

export interface FrameCaptureRequest {
  times: number[];
  mode: 'from-current' | 'reset-and-play';
  width: number;
  height: number;
}

export interface CapturedFrame {
  data: string;
  mimeType: 'image/png';
  requestedTime: number;
  elapsedTime: number;
  shaderTime: number;
  frame: number;
  path: string;
  compileSequence: number | null;
  renderedSequence: number | null;
}

export interface FrameCaptureStatus {
  id: string;
  state: 'capturing' | 'completed' | 'failed' | 'cancelled';
  requested: FrameCaptureRequest;
  startedAt: string;
  previewSwitched: boolean;
  recompiled: boolean;
  frames: CapturedFrame[];
  source: { path: string; compileSequence: number | null; renderedSequence: number | null; time: number; revision: null };
  error?: string;
}

interface Job { status: FrameCaptureStatus; controller: AbortController; startMs: number; initial: ViewerSnapshot; timer?: ReturnType<typeof setTimeout>; bytes: number; }

/** Samples a running preview at elapsed wall-clock targets; it never seeks or rewinds feedback. */
export class ViewerFrameCapture {
  private jobs = new Map<string, Job>();
  private serial = 0;
  private disposed = false;
  private starting = false;

  constructor(private readonly host: ViewerFrameCaptureHost) {}

  async start(request: FrameCaptureRequest, signal?: AbortSignal): Promise<FrameCaptureStatus> {
    this.validate(request);
    if (this.disposed) {
      throw new Error('Viewer closed.');
    }
    if (signal?.aborted) {
      throw new Error('Frame capture start cancelled.');
    }
    if (this.starting || [...this.jobs.values()].some(job => job.status.state === 'capturing')) {
      throw new Error('A frame capture is already active.');
    }
    const beforeReset = this.host.snapshot();
    let initial: ViewerSnapshot;
    this.starting = true;
    try {
      if (request.mode === 'reset-and-play') {
        await this.host.reset();
      }
      if (this.disposed || signal?.aborted) {
        throw new Error('Frame capture start cancelled.');
      }
      initial = this.host.snapshot();
      if (initial.path !== beforeReset.path) {
        throw new Error('Preview switched while frame capture was starting.');
      }
      if (!initial.path) {
        throw new Error('No shader is loaded in this preview.');
      }
    } finally {
      this.starting = false;
    }
    const controller = new AbortController();
    const job: Job = {
      status: { id: `frames-${++this.serial}-${crypto.randomUUID()}`, state: 'capturing', requested: { ...request, times: [...request.times] }, startedAt: new Date().toISOString(), previewSwitched: false, recompiled: false, frames: [], source: { path: initial.path, compileSequence: initial.compileSequence, renderedSequence: initial.renderedSequence, time: initial.time, revision: null } },
      controller, startMs: performance.now(), initial, bytes: 0,
    };
    this.jobs.set(job.status.id, job);
    this.trim();
    void this.captureNext(job, 0);
    return this.status(job.status.id);
  }

  status(id: string): FrameCaptureStatus {
    return structuredClone(this.require(id).status);
  }
  cancel(id: string): void {
    this.abort(this.require(id), 'cancelled');
  }
  dispose(): void {
    this.disposed = true; for (const job of this.jobs.values()) {
      this.abort(job, 'cancelled');
    } this.jobs.clear();
  }

  private async captureNext(job: Job, index: number): Promise<void> {
    if (job.controller.signal.aborted || job.status.state !== 'capturing') {
      return;
    }
    const requested = job.status.requested.times[index];
    if (requested === undefined) {
      job.status.state = 'completed'; this.trim(); return;
    }
    const delay = Math.max(0, requested * 1000 - (performance.now() - job.startMs));
    job.timer = setTimeout(async () => {
      try {
        const before = this.host.snapshot();
        if (!this.samePreview(job, before)) {
          return;
        }
        const image = await this.host.captureFrame();
        if (job.controller.signal.aborted) {
          return;
        }
        const after = this.host.snapshot();
        if (!this.samePreview(job, after)) {
          return;
        }
        const elapsedTime = (performance.now() - job.startMs) / 1000;
        const data = await png(image, job.status.requested.width, job.status.requested.height);
        if (job.controller.signal.aborted || !this.samePreview(job, this.host.snapshot())) {
          return;
        }
        const bytes = base64Bytes(data);
        if (bytes > MAX_FRAME_BYTES || job.bytes + bytes > MAX_TOTAL_BYTES) {
          throw new Error('Frame artifact size limit exceeded.');
        }
        job.bytes += bytes;
        job.status.frames.push({ data, mimeType: 'image/png', requestedTime: requested, elapsedTime, shaderTime: after.time, frame: after.frame, path: after.path, compileSequence: after.compileSequence, renderedSequence: after.renderedSequence });
        await this.captureNext(job, index + 1);
      } catch (error) {
        if (job.status.state === 'capturing') {
          this.fail(job, error);
        }
      }
    }, delay);
  }

  private samePreview(job: Job, snapshot: ViewerSnapshot): boolean {
    if (snapshot.path !== job.initial.path) {
      job.status.previewSwitched = true; this.abort(job, 'cancelled'); return false;
    }
    if (snapshot.compileSequence !== job.initial.compileSequence || snapshot.renderedSequence !== job.initial.renderedSequence) {
      job.status.recompiled = true; this.abort(job, 'cancelled'); return false;
    }
    return true;
  }
  private abort(job: Job, state: 'cancelled'): void {
    clearTimeout(job.timer); job.controller.abort(); if (job.status.state === 'capturing') {
      job.status.state = state;
    } this.trim();
  }
  private fail(job: Job, error: unknown): void {
    clearTimeout(job.timer); job.status.state = 'failed'; job.status.error = error instanceof Error ? error.message : String(error); this.trim();
  }
  private require(id: string): Job {
    const job = this.jobs.get(id); if (!job) {
      throw new Error('Unknown frame capture id.');
    } return job;
  }
  private trim(): void {
    const done = [...this.jobs.values()].filter(job => job.status.state !== 'capturing'); while (done.length > MAX_JOBS) {
      this.jobs.delete(done.shift()!.status.id);
    }
  }
  private validate(value: FrameCaptureRequest): void {
    if (!Array.isArray(value.times) || !value.times.length || value.times.length > 8 || value.times.some(time => !Number.isFinite(time) || time < 0 || time > 60) || value.times.some((time, index) => index > 0 && time <= value.times[index - 1])) {
      throw new Error('times must contain 1 to 8 unique sorted seconds from 0 to 60.');
    }
    if (value.mode !== 'from-current' && value.mode !== 'reset-and-play') {
      throw new Error('Invalid frame capture mode.');
    }
    if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 1920 || value.height > 1080) {
      throw new Error('width and height must be positive integers no larger than 1920×1080.');
    }
  }
}

async function png(image: ImageData, width: number, height: number): Promise<string> {
  const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
  const sourceContext = source.getContext('2d'); if (!sourceContext) {
    throw new Error('Could not encode captured frame.');
  }
  sourceContext.putImageData(image, 0, 0);
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  const context = output.getContext('2d'); if (!context) {
    throw new Error('Could not scale captured frame.');
  }
  context.drawImage(source, 0, 0, width, height);
  return output.toDataURL('image/png').split(',')[1] ?? '';
}
function base64Bytes(data: string): number {
  return Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
}
