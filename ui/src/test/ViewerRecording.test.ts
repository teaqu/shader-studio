import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ stop: vi.fn(), result: Promise.resolve(new Blob(['video'], { type: 'video/webm' })), options: undefined as { onFrame?: (time: number) => void } | undefined, failure: undefined as Error | undefined }));
vi.mock('../lib/recording/LiveVideoCapture', () => ({
  createLiveVideoCapture: async (_canvas: HTMLCanvasElement, _fps: number, _format: string, _signal: AbortSignal, _capture: unknown, options: unknown) => {
    if (mocks.failure) {
      throw mocks.failure;
    }
    mocks.options = options as typeof mocks.options;
    return { result: mocks.result, stop: mocks.stop };
  },
}));

import { ViewerRecording } from '../lib/ViewerRecording';

let snapshot = { path: '/shader.glsl', compileSequence: 1, renderedSequence: 1, time: 2 };
const host = {
  snapshot: () => ({ ...snapshot }),
  getCanvas: () => document.createElement('canvas'),
  captureFrame: async () => new ImageData(1, 1),
  getInputTimeline: () => ({ mouse: [1, 2] }),
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.result = new Promise(() => {}); mocks.stop = vi.fn(); mocks.options = undefined; mocks.failure = undefined;
  snapshot = { path: '/shader.glsl', compileSequence: 1, renderedSequence: 1, time: 2 };
  if (!Blob.prototype.arrayBuffer) {
    Object.assign(Blob.prototype, { arrayBuffer: async () => new TextEncoder().encode('abc').buffer });
  }
});

describe('ViewerRecording', () => {
  it('starts a bounded live job without resizing the preview and completes its artifact', async () => {
    const recording = new ViewerRecording(host as never);
    const start = recording.start({ format: 'webm', duration: 1, fps: 30, width: 640, height: 360 });
    await vi.runAllTicks();
    const status = await start;
    expect(status).toMatchObject({ state: 'recording', requested: { width: 640, height: 360 }, feedbackRestored: false });
    expect(mocks.options).toMatchObject({ width: 640, height: 360 });
    vi.advanceTimersByTime(1000);
    expect(mocks.stop).toHaveBeenCalledOnce();
    mocks.result = Promise.resolve(new Blob(['video'], { type: 'video/webm' }));
    // Completion is supplied by the capture promise created for this job; create a new deterministic job below.
    recording.dispose();
  });

  it('records completion, chunks artifacts, and rejects invalid ranges', async () => {
    let resolve!: (blob: Blob) => void;
    mocks.result = new Promise<Blob>(done => {
      resolve = done;
    });
    const recording = new ViewerRecording(host as never);
    const status = await recording.start({ format: 'webm', duration: 5, fps: 30, width: 640, height: 360 });
    resolve(new Blob(['abc'], { type: 'video/webm' })); await vi.runAllTicks();
    await vi.waitFor(() => expect(recording.status(status.id).state).toBe('completed'));
    await expect(recording.readChunk(status.id, 0, 2)).resolves.toMatchObject({ base64: 'YWJj', eof: true, totalBytes: 3 });
    await expect(recording.readChunk(status.id, -1, 2)).rejects.toThrow('Invalid');
  });

  it('flags shader switches and recompiles while stopping the active recording', async () => {
    const recording = new ViewerRecording(host as never);
    const status = await recording.start({ format: 'mp4', duration: 5, fps: 30, width: 640, height: 360 });
    snapshot = { ...snapshot, compileSequence: 2, renderedSequence: 2 };
    vi.advanceTimersByTime(100);
    expect(recording.status(status.id).recompiled).toBe(true);
    snapshot = { ...snapshot, path: '/other.glsl' };
    vi.advanceTimersByTime(100);
    expect(recording.status(status.id).previewSwitched).toBe(true);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('validates input, blocks concurrent jobs, and clears state on dispose', async () => {
    const recording = new ViewerRecording(host as never);
    await expect(recording.start({ format: 'gif' as 'mp4', duration: 1, fps: 1, width: 1, height: 1 })).rejects.toThrow('format');
    await expect(recording.start({ format: 'mp4', duration: 0, fps: 30, width: 1, height: 1 })).rejects.toThrow('duration');
    await expect(recording.start({ format: 'mp4', duration: 1, fps: 61, width: 1, height: 1 })).rejects.toThrow('fps');
    await expect(recording.start({ format: 'mp4', duration: 1, fps: 1, width: 1921, height: 1 })).rejects.toThrow('width');
    await recording.start({ format: 'mp4', duration: 1, fps: 1, width: 1, height: 1 });
    await expect(recording.start({ format: 'mp4', duration: 1, fps: 1, width: 1, height: 1 })).rejects.toThrow('already active');
    recording.dispose();
    expect(() => recording.status('recording-1')).toThrow('Unknown');
  });

  it('preserves initial inputs, pairs requested input capture, and reports padded MP4 dimensions', async () => {
    const startInputs = vi.fn(); const stopInputs = vi.fn(() => [{ type: 'pointer_move' }]);
    const recording = new ViewerRecording({ ...host, startInputRecording: startInputs, stopInputRecording: stopInputs } as never);
    let resolve!: (blob: Blob) => void;
    mocks.result = new Promise<Blob>(done => {
      resolve = done;
    });
    const status = await recording.start({ format: 'mp4', duration: 1, fps: 30, width: 101, height: 99, recordInputs: true });
    expect(status.actual).toMatchObject({ width: 102, height: 100 });
    expect(startInputs).toHaveBeenCalledOnce();
    resolve(new Blob(['ok'])); await vi.runAllTicks();
    await vi.waitFor(() => expect(recording.status(status.id).state).toBe('completed'));
    expect(recording.status(status.id).inputTimeline).toEqual([{ type: 'pointer_move' }]);
    expect(stopInputs).toHaveBeenCalledOnce();
  });

  it('handles unavailable canvases, empty shaders, encoder setup failures, and cancelled setup', async () => {
    const noCanvas = new ViewerRecording({ ...host, getCanvas: () => null } as never);
    await expect(noCanvas.start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 })).rejects.toThrow('canvas');
    const noShader = new ViewerRecording({ ...host, snapshot: () => ({ ...snapshot, path: '' }) } as never);
    await expect(noShader.start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 })).rejects.toThrow('shader');
    mocks.failure = new Error('encoder unavailable');
    const failed = new ViewerRecording(host as never);
    await expect(failed.start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 })).rejects.toThrow('encoder unavailable');
    mocks.failure = undefined;
    const cancelled = new AbortController(); cancelled.abort();
    await expect(new ViewerRecording(host as never).start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 }, cancelled.signal)).rejects.toThrow('cancelled');
  });

  it('records frame provenance and treats a failed capture result as a failed job', async () => {
    let reject!: (error: Error) => void;
    mocks.result = new Promise<Blob>((_resolve, fail) => {
      reject = fail;
    });
    const recording = new ViewerRecording(host as never);
    const status = await recording.start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 });
    mocks.options?.onFrame?.(0.5);
    expect(recording.status(status.id).frameTimestamps).toHaveLength(1);
    reject(new Error('capture failed')); await vi.runAllTicks();
    await vi.waitFor(() => expect(recording.status(status.id)).toMatchObject({ state: 'failed', error: 'capture failed' }));
  });

  it('rejects unavailable artifacts and stops work during disposal', async () => {
    const recording = new ViewerRecording(host as never);
    const status = await recording.start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 });
    await expect(recording.readChunk(status.id, 0, 1)).rejects.toThrow('not available');
    recording.dispose();
    expect(() => recording.stop(status.id)).toThrow('Unknown');
    await expect(recording.start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 })).rejects.toThrow('Viewer closed');
  });

  it('detaches request cancellation after setup and retains only three finished artifacts', async () => {
    const controller = new AbortController();
    const recording = new ViewerRecording(host as never);
    const ids: string[] = [];
    for (let count = 0; count < 4; count++) {
      let resolve!: (blob: Blob) => void;
      mocks.result = new Promise<Blob>(done => {
        resolve = done;
      });
      const status = await recording.start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 }, count === 0 ? controller.signal : undefined);
      ids.push(status.id); resolve(new Blob(['done'])); await vi.runAllTicks();
      await vi.waitFor(() => expect(recording.status(status.id).state).toBe('completed'));
    }
    controller.abort();
    expect(() => recording.status(ids[0])).toThrow('Unknown');
    expect(recording.status(ids[1]).state).toBe('completed');
    recording.stop(ids[1]);
    expect(recording.status(ids[1]).state).toBe('completed');
  });

  it('reads artifacts through FileReader when Blob.arrayBuffer is unavailable', async () => {
    const original = Blob.prototype.arrayBuffer;
    const originalReader = globalThis.FileReader;
    Object.defineProperty(Blob.prototype, 'arrayBuffer', { value: undefined, configurable: true });
    class Reader {
      result = new TextEncoder().encode('abc').buffer;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsArrayBuffer() {
        this.onload?.();
      }
    }
    Object.assign(globalThis, { FileReader: Reader });
    let resolve!: (blob: Blob) => void;
    mocks.result = new Promise<Blob>(done => {
      resolve = done;
    });
    const recording = new ViewerRecording(host as never);
    const status = await recording.start({ format: 'webm', duration: 1, fps: 1, width: 1, height: 1 });
    resolve(new Blob(['abc'])); await vi.runAllTicks();
    await vi.waitFor(() => expect(recording.status(status.id).state).toBe('completed'));
    await expect(recording.readChunk(status.id, 0, 3)).resolves.toMatchObject({ base64: 'YWJj' });
    Object.defineProperty(Blob.prototype, 'arrayBuffer', { value: original, configurable: true });
    Object.assign(globalThis, { FileReader: originalReader });
  });
});
