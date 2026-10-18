import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewerFrameCapture } from '../lib/ViewerFrameCapture';

let state = { path: '/shader.glsl', compileSequence: 1, renderedSequence: 1, time: 2, frame: 3 };
const reset = vi.fn(async () => {});
const captureFrame = vi.fn(async () => new ImageData(2, 2));
const host = { snapshot: () => ({ ...state }), captureFrame, reset };

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  state = { path: '/shader.glsl', compileSequence: 1, renderedSequence: 1, time: 2, frame: 3 };
  vi.spyOn(document, 'createElement').mockImplementation(((name: string) => {
    if (name !== 'canvas') {
      return document.createElement(name);
    }
    return { width: 0, height: 0, getContext: () => ({ putImageData: vi.fn(), drawImage: vi.fn() }), toDataURL: () => 'data:image/png;base64,cG5n' } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
});

describe('ViewerFrameCapture', () => {
  it('captures ordered wall-clock frames with snapshot provenance and reset mode', async () => {
    const capture = new ViewerFrameCapture(host as never);
    const job = await capture.start({ times: [0, 0.2], mode: 'reset-and-play', width: 20, height: 10 });
    expect(reset).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(capture.status(job.id)).toMatchObject({ state: 'completed', frames: [{ requestedTime: 0, path: '/shader.glsl' }, { requestedTime: 0.2, frame: 3 }] });
  });

  it('rejects invalid requests and missing previews', async () => {
    const capture = new ViewerFrameCapture(host as never);
    await expect(capture.start({ times: [1, 1], mode: 'from-current', width: 1, height: 1 })).rejects.toThrow('sorted');
    await expect(capture.start({ times: [0], mode: 'other' as 'from-current', width: 1, height: 1 })).rejects.toThrow('mode');
    await expect(capture.start({ times: [0], mode: 'from-current', width: 0, height: 1 })).rejects.toThrow('width');
    await expect(new ViewerFrameCapture({ ...host, snapshot: () => ({ ...state, path: '' }) } as never).start({ times: [0], mode: 'from-current', width: 1, height: 1 })).rejects.toThrow('No shader');
  });

  it('cancels on switch or recompile and discards an in-flight capture', async () => {
    let resolve!: (image: ImageData) => void;
    captureFrame.mockReturnValueOnce(new Promise(done => {
      resolve = done;
    }));
    const capture = new ViewerFrameCapture(host as never);
    const job = await capture.start({ times: [0], mode: 'from-current', width: 1, height: 1 });
    await vi.runOnlyPendingTimersAsync();
    state = { ...state, path: '/other.glsl' }; resolve(new ImageData(1, 1)); await vi.runAllTicks();
    expect(capture.status(job.id)).toMatchObject({ state: 'cancelled', previewSwitched: true, frames: [] });
    state = { path: '/shader.glsl', compileSequence: 1, renderedSequence: 1, time: 2, frame: 3 };
    const second = await capture.start({ times: [0], mode: 'from-current', width: 1, height: 1 }); state = { ...state, compileSequence: 2 };
    await vi.runAllTimersAsync();
    expect(capture.status(second.id)).toMatchObject({ state: 'cancelled', recompiled: true });
  });

  it('supports cancellation and disposal', async () => {
    const capture = new ViewerFrameCapture(host as never);
    const job = await capture.start({ times: [10], mode: 'from-current', width: 1, height: 1 });
    capture.cancel(job.id); expect(capture.status(job.id).state).toBe('cancelled');
    capture.dispose(); expect(() => capture.status(job.id)).toThrow('Unknown');
    await expect(capture.start({ times: [0], mode: 'from-current', width: 1, height: 1 })).rejects.toThrow('Viewer closed');
  });

  it('records capture failures as failed jobs', async () => {
    const capture = new ViewerFrameCapture({ ...host, captureFrame: async () => {
      throw new Error('GPU lost');
    } } as never);
    const job = await capture.start({ times: [0], mode: 'from-current', width: 1, height: 1 });
    await vi.runAllTimersAsync();
    expect(capture.status(job.id)).toMatchObject({ state: 'failed', error: 'GPU lost' });
  });

  it('cancels while reset is pending and refuses concurrent jobs', async () => {
    let finishReset!: () => void;
    const delayed = new ViewerFrameCapture({ ...host, reset: () => new Promise<void>(done => {
      finishReset = done;
    }) } as never);
    const controller = new AbortController();
    const starting = delayed.start({ times: [0], mode: 'reset-and-play', width: 1, height: 1 }, controller.signal);
    controller.abort(); finishReset();
    await expect(starting).rejects.toThrow('cancelled');
    const capture = new ViewerFrameCapture(host as never);
    await capture.start({ times: [10], mode: 'from-current', width: 1, height: 1 });
    await expect(capture.start({ times: [0], mode: 'from-current', width: 1, height: 1 })).rejects.toThrow('already active');
  });
});
