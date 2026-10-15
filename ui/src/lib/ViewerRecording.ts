import type { ViewerSnapshot } from '@shader-studio/types';
import { createLiveVideoCapture, type LiveVideoCapture } from './recording/LiveVideoCapture';

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_COMPLETED = 3;

export interface ViewerRecordingHost {
  snapshot(): ViewerSnapshot;
  getCanvas(): HTMLCanvasElement | null;
  captureFrame(): Promise<ImageData>;
  getInputTimeline?(): unknown;
  startInputRecording?(): void;
  stopInputRecording?(): unknown;
}

export interface ViewerRecordingStart {
  format: 'mp4' | 'webm';
  duration: number;
  fps: number;
  width: number;
  height: number;
  recordInputs?: boolean;
}

export interface ViewerRecordingStatus {
  id: string;
  state: 'recording' | 'finalizing' | 'completed' | 'failed' | 'stopped';
  format: 'mp4' | 'webm';
  mimeType: string;
  requested: { duration: number; fps: number; width: number; height: number };
  actual: { fps: number | null; width: number; height: number; droppedFrames: number | null };
  startedAt: string;
  stoppedAt: string | null;
  frameTimestamps: { wallTime: string; videoTime: number; path: string; compileSequence: number | null; renderedSequence: number | null; time: number }[];
  source: { path: string; compileSequence: number | null; renderedSequence: number | null; time: number; revision: null };
  initialInputState: unknown;
  inputTimeline: unknown;
  previewSwitched: boolean;
  recompiled: boolean;
  feedbackRestored: false;
  artifact: { bytes: number; available: boolean };
  error?: string;
}

interface Job {
  status: ViewerRecordingStatus;
  controller: AbortController;
  capture?: LiveVideoCapture;
  stopTimer?: ReturnType<typeof setTimeout>;
  watchTimer?: ReturnType<typeof setInterval>;
  blob?: Blob;
  recordInputs: boolean;
  detachSetupAbort?: () => void;
}

/** Bounded live-preview recordings for RPC clients; never changes preview size or playback. */
export class ViewerRecording {
  private jobs = new Map<string, Job>();
  private sequence = 0;
  private disposed = false;

  constructor(private readonly host: ViewerRecordingHost) {}

  async start(payload: ViewerRecordingStart, signal?: AbortSignal): Promise<ViewerRecordingStatus> {
    this.validate(payload);
    if (this.disposed) {
      throw new Error('Viewer closed.');
    }
    if (signal?.aborted) {
      throw new Error('Recording start cancelled.');
    }
    if ([...this.jobs.values()].some(job => job.status.state === 'recording' || job.status.state === 'finalizing')) {
      throw new Error('A recording is already active.');
    }
    const canvas = this.host.getCanvas();
    if (!canvas) {
      throw new Error('No preview canvas is available.');
    }
    const snapshot = this.host.snapshot();
    if (!snapshot.path) {
      throw new Error('No shader is loaded in this preview.');
    }
    const id = `recording-${++this.sequence}-${crypto.randomUUID()}`;
    const controller = new AbortController();
    const status: ViewerRecordingStatus = {
      id, state: 'recording', format: payload.format, mimeType: `video/${payload.format}`,
      requested: { duration: payload.duration, fps: payload.fps, width: payload.width, height: payload.height },
      actual: { fps: null, width: payload.format === 'mp4' && payload.width % 2 ? payload.width + 1 : payload.width, height: payload.format === 'mp4' && payload.height % 2 ? payload.height + 1 : payload.height, droppedFrames: null },
      startedAt: new Date().toISOString(), stoppedAt: null, frameTimestamps: [],
      source: { path: snapshot.path, compileSequence: snapshot.compileSequence, renderedSequence: snapshot.renderedSequence, time: snapshot.time, revision: null },
      initialInputState: snapshot.inputs ?? null, inputTimeline: null,
      previewSwitched: false, recompiled: false, feedbackRestored: false,
      artifact: { bytes: 0, available: false },
    };
    const job: Job = { status, controller, recordInputs: Boolean(payload.recordInputs) };
    if (payload.recordInputs) {
      this.host.startInputRecording?.();
    }
    this.jobs.set(id, job);
    this.watch(job);
    const abortSetup = () => {
      controller.abort(new Error('Recording start cancelled.'));
      this.stop(id);
    };
    signal?.addEventListener('abort', abortSetup, { once: true });
    job.detachSetupAbort = () => signal?.removeEventListener('abort', abortSetup);
    try {
      job.capture = await createLiveVideoCapture(canvas, payload.fps, payload.format, controller.signal, () => this.host.captureFrame(), {
        width: payload.width, height: payload.height, maxBytes: MAX_ARTIFACT_BYTES,
        onFrame: timestamp => {
          const frame = this.host.snapshot();
          this.observe(job, frame);
          status.frameTimestamps.push({ wallTime: new Date().toISOString(), videoTime: timestamp, path: frame.path, compileSequence: frame.compileSequence, renderedSequence: frame.renderedSequence, time: frame.time });
        },
      });
      if (status.state !== 'recording') {
        job.capture.stop();
      }
      job.detachSetupAbort?.();
      job.detachSetupAbort = undefined;
      job.stopTimer = setTimeout(() => this.stop(id), payload.duration * 1000);
      void job.capture.result.then(blob => this.complete(job, blob), error => this.fail(job, error));
      return this.status(id);
    } catch (error) {
      this.fail(job, error);
      throw error;
    }
  }

  stop(id: string): void {
    const job = this.require(id);
    if (job.status.state !== 'recording') {
      return;
    }
    job.status.state = 'finalizing';
    this.finishInputs(job);
    job.capture?.stop();
  }

  status(id: string): ViewerRecordingStatus {
    return structuredClone(this.require(id).status);
  }

  async readChunk(id: string, offset: number, maxBytes: number): Promise<{ base64: string; mimeType: string; totalBytes: number; offset: number; eof: boolean }> {
    const job = this.require(id);
    if (!job.blob || !job.status.artifact.available) {
      throw new Error('Recording artifact is not available.');
    }
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_000_000) {
      throw new Error('Invalid artifact range.');
    }
    const bytes = new Uint8Array(await blobBytes(job.blob.slice(offset, offset + maxBytes)));
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return { base64: btoa(binary), mimeType: job.status.mimeType, totalBytes: job.blob.size, offset, eof: offset + bytes.length >= job.blob.size };
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs.values()) {
      this.clear(job);
      job.controller.abort(new Error('Viewer closed.'));
    }
    this.jobs.clear();
  }

  private complete(job: Job, blob: Blob): void {
    if (job.status.state === 'failed') {
      return;
    }
    this.clear(job);
    job.status.stoppedAt = new Date().toISOString();
    this.finishInputs(job);
    const frames = job.status.frameTimestamps;
    const span = frames.length > 1 ? frames[frames.length - 1].videoTime - frames[0].videoTime : 0;
    job.status.actual.fps = span > 0 ? (frames.length - 1) / span : null;
    if (blob.size > MAX_ARTIFACT_BYTES) {
      job.status.state = 'failed'; job.status.error = 'Recording exceeds the 32 MiB artifact limit.'; this.evict(); return;
    }
    job.blob = blob; job.status.state = 'completed'; job.status.artifact = { bytes: blob.size, available: true };
    this.evict();
  }

  private fail(job: Job, error: unknown): void {
    this.clear(job);
    job.status.state = 'failed'; job.status.stoppedAt = new Date().toISOString();
    job.status.error = error instanceof Error ? error.message : String(error);
    this.finishInputs(job);
    this.evict();
  }

  private watch(job: Job): void {
    job.watchTimer = setInterval(() => this.observe(job, this.host.snapshot()), 100);
  }

  private observe(job: Job, now: ViewerSnapshot): void {
    if (now.path !== job.status.source.path) {
      job.status.previewSwitched = true;
      this.stop(job.status.id);
    }
    if (now.compileSequence !== job.status.source.compileSequence || now.renderedSequence !== job.status.source.renderedSequence) {
      job.status.recompiled = true;
    }
  }

  private finishInputs(job: Job): void {
    if (job.recordInputs) {
      job.status.inputTimeline = this.host.stopInputRecording?.() ?? this.host.getInputTimeline?.() ?? null;
      job.recordInputs = false;
    }
  }

  private clear(job: Job): void {
    clearTimeout(job.stopTimer); clearInterval(job.watchTimer);
    job.detachSetupAbort?.();
    job.detachSetupAbort = undefined;
  }
  private require(id: string): Job {
    const job = this.jobs.get(id); if (!job) {
      throw new Error('Unknown recording id.');
    } return job;
  }
  private evict(): void {
    const complete = [...this.jobs.values()].filter(job => job.status.state === 'completed' || job.status.state === 'failed' || job.status.state === 'stopped').sort((a, b) => Date.parse(a.status.stoppedAt ?? '') - Date.parse(b.status.stoppedAt ?? ''));
    for (const job of complete.slice(0, Math.max(0, complete.length - MAX_COMPLETED))) {
      this.jobs.delete(job.status.id);
    }
  }
  private validate(value: ViewerRecordingStart): void {
    if (value.format !== 'mp4' && value.format !== 'webm') {
      throw new Error('format must be mp4 or webm.');
    }
    if (!Number.isFinite(value.duration) || value.duration < 0.1 || value.duration > 60) {
      throw new Error('duration must be between 0.1 and 60 seconds.');
    }
    if (!Number.isInteger(value.fps) || value.fps < 1 || value.fps > 60) {
      throw new Error('fps must be an integer between 1 and 60.');
    }
    if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 || value.width > 1920 || value.height > 1080) {
      throw new Error('width and height must be positive integers no larger than 1920×1080.');
    }
  }
}

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Could not read recording artifact.'));
    reader.readAsArrayBuffer(blob);
  });
}
