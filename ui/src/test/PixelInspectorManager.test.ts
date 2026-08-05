import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PixelInspectorManager } from '../lib/PixelInspectorManager';
import type { RenderingEngine } from '../../../rendering/src/types';
import type { PixelRegionResult } from '../../../rendering/src/types';
import type { TimeManager } from '../../../rendering/src/util/TimeManager';
import { WebGPUPixelRegionCapturer } from '../../../rendering/src/webgpu/WebGPUPixelRegionCapturer';

const REGION_SIZE = 60;

function result(requestId: number, centerX: number, centerY: number, colour = [3, 240, 2, 255]): PixelRegionResult {
  const rgba = new Uint8ClampedArray(REGION_SIZE * REGION_SIZE * 4);
  const center = ((REGION_SIZE / 2) * REGION_SIZE + REGION_SIZE / 2) * 4;
  rgba.set(colour, center);
  return { requestId, centerX, centerY, width: REGION_SIZE, height: REGION_SIZE, rgba };
}

describe('PixelInspectorManager async region readback', () => {
  let manager: PixelInspectorManager;
  let requests: PixelRegionResult[] = [];
  let queued: Array<[number, number, number]> = [];
  let engine: RenderingEngine;
  let timeManager: TimeManager;
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;

  const runFrame = (time: number) => {
    const callbacks = [...rafCallbacks.values()];
    rafCallbacks.clear();
    callbacks.forEach((callback) => callback(time));
  };

  beforeEach(() => {
    requests = [];
    queued = [];
    rafCallbacks = new Map();
    nextRafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = ++nextRafId;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => rafCallbacks.delete(id));
    // The manager only needs this narrow RenderingEngine surface in these unit tests.
    engine = {
      requestPixelRegion: vi.fn((id: number, x: number, y: number) => {
        queued.push([id, x, y]);
        return true;
      }),
      collectPixelRegionResults: vi.fn(() => requests.splice(0)),
      cancelPixelRegionRequests: vi.fn(),
      render: vi.fn(),
    } as unknown as RenderingEngine;
    timeManager = { isPaused: vi.fn(() => false) } as unknown as TimeManager;
    manager = new PixelInspectorManager();
    manager.initialize(engine, timeManager, {
      width: 800,
      height: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLCanvasElement);
  });

  afterEach(() => {
    manager.dispose();
    vi.restoreAllMocks();
  });

  const move = (x = 400.9, y = 300.1) => manager.handleMouseMove({ clientX: x, clientY: y } as MouseEvent);
  const enableAt = (time = 0) => {
    manager.setEnabled(true); move(); runFrame(time);
  };

  it('starts with an empty atomic region snapshot', () => {
    expect(manager.getState()).toMatchObject({ region: null, pixelRGB: null, canvasPosition: null });
  });

  it('queues floored coordinates at 30fps and polls results every RAF', () => {
    enableAt(0);
    expect(queued).toEqual([[1, 400, 300]]);
    runFrame(20);
    expect(queued).toHaveLength(1);
    requests.push(result(1, 400, 300));
    runFrame(21);
    expect(manager.getState().pixelRGB).toEqual({ r: 3, g: 240, b: 2 });
    runFrame(34);
    expect(queued).toEqual([[1, 400, 300], [2, 400, 300]]);
  });

  it.each(['GLSL', 'Slang'])('keeps the previous %s region while the next read is pending', () => {
    enableAt();
    requests.push(result(1, 400, 300));
    runFrame(1);
    const accepted = manager.getState().region;
    move(500, 200);
    runFrame(34);
    expect(manager.getState().region).toBe(accepted);
    expect(manager.getState().canvasPosition).toEqual({ x: 400, y: 300 });
  });

  it('publishes the newest valid completed result as one consistent snapshot', () => {
    enableAt();
    runFrame(34);
    runFrame(68);
    const newest = result(3, 100, 200, [9, 8, 7, 6]);
    requests.push(result(1, 400, 300, [1, 2, 3, 4]), newest, result(2, 1, 2));
    runFrame(69);
    expect(manager.getState()).toMatchObject({
      pixelRGB: { r: 9, g: 8, b: 7 },
      canvasPosition: { x: 100, y: 200 },
      fragCoord: { x: 100, y: 400 },
    });
    expect(manager.getState().region?.rgba).toBe(newest.rgba);
  });

  it('accepts a completed result after a newer target has been queued', () => {
    enableAt();
    move(500, 200);
    runFrame(34);
    requests.push(result(1, 400, 300));
    runFrame(35);
    expect(manager.getState().canvasPosition).toEqual({ x: 400, y: 300 });
  });

  it('ignores stale and malformed results without clearing a prior snapshot', () => {
    enableAt();
    requests.push(result(1, 400, 300));
    runFrame(1);
    const accepted = manager.getState().region;
    requests.push({ ...result(2, 500, 200), width: 59 }, result(1, 1, 1));
    runFrame(2);
    expect(manager.getState().region).toBe(accepted);
  });

  it('rejects hostile collection values and future IDs without advancing the accepted floor', () => {
    enableAt();
    const first = result(1, 400, 300, [1, 2, 3, 255]);
    requests.push(first);
    runFrame(1);
    runFrame(34); // Issues request 2.
    const accepted = manager.getState().region;
    const collect = engine.collectPixelRegionResults as ReturnType<typeof vi.fn>;
    collect
      .mockReturnValueOnce('not an array')
      .mockReturnValueOnce([
        null,
        undefined,
        7,
        {},
        { ...result(2, 10, 20), rgba: new Uint8Array(REGION_SIZE * REGION_SIZE * 4) },
        { ...result(2, 10, 20), rgba: new Uint8ClampedArray(4) },
        { ...result(Number.NaN, 10, 20) },
        { ...result(Number.POSITIVE_INFINITY, 10, 20) },
        { ...result(1.5, 10, 20) },
        { ...result(999, 10, 20) },
        { ...result(2, Number.POSITIVE_INFINITY, 20) },
        { ...result(2, 10, Number.NaN) },
        { ...result(2, 10.5, 20) },
        { ...result(2, 10, 20.5) },
      ]);

    expect(() => runFrame(35)).not.toThrow();
    expect(rafCallbacks).toHaveLength(1);
    expect(() => runFrame(36)).not.toThrow();
    expect(rafCallbacks).toHaveLength(1);
    expect(manager.getState().region).toBe(accepted);

    const genuine = result(2, 500, 200, [9, 8, 7, 255]);
    requests.push(genuine);
    runFrame(37);
    expect(manager.getState().region?.rgba).toBe(genuine.rgba);
    expect(manager.getState().pixelRGB).toEqual({ r: 9, g: 8, b: 7 });
  });

  it('reschedules its RAF in finally when an unexpected publication error escapes', () => {
    manager.dispose();
    let throwOnUpdate = false;
    manager = new PixelInspectorManager(() => {
      if (throwOnUpdate) {
        throw new Error('state callback failed');
      }
    });
    manager.initialize(engine, timeManager, {
      width: 800,
      height: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLCanvasElement);
    enableAt();
    requests.push(result(1, 400, 300));
    throwOnUpdate = true;

    try {
      expect(() => runFrame(1)).toThrowError('state callback failed');
      expect(rafCallbacks).toHaveLength(1);
    } finally {
      throwOnUpdate = false;
    }
  });

  it('keeps the accepted snapshot and RAF alive when collection throws', () => {
    enableAt();
    const first = result(1, 400, 300, [1, 2, 3, 255]);
    requests.push(first);
    runFrame(1);
    const collect = engine.collectPixelRegionResults as ReturnType<typeof vi.fn>;
    collect.mockImplementationOnce(() => {
      throw new Error('readback collection failed');
    });

    runFrame(2);

    expect(manager.getState().region?.rgba).toBe(first.rgba);
    expect(rafCallbacks).toHaveLength(1);
    runFrame(34);
    expect(queued).toContainEqual([2, 400, 300]);
  });

  it('keeps an accepted UI snapshot when a real mapped WebGPU readback fails', async () => {
    enableAt();
    const first = result(1, 400, 300, [1, 2, 3, 255]);
    requests.push(first);
    runFrame(1);
    const failingBuffer = {
      mapAsync: vi.fn(() => Promise.reject(new Error('device lost'))),
      getMappedRange: vi.fn(),
      unmap: vi.fn(),
      destroy: vi.fn(),
    };
    const capturer = new WebGPUPixelRegionCapturer({
      createBuffer: vi.fn(() => failingBuffer),
    } as unknown as GPUDevice, 'rgba8unorm');
    capturer.queue({ requestId: 2, centerX: 400, centerY: 300 });
    capturer.encodeAfterRender({ copyTextureToBuffer: vi.fn() } as unknown as GPUCommandEncoder, {} as GPUTexture, 800, 600);
    capturer.beginMappings();
    await Promise.resolve();
    await Promise.resolve();
    (engine.collectPixelRegionResults as ReturnType<typeof vi.fn>).mockImplementationOnce(() => capturer.collectResults());

    runFrame(2);

    expect(manager.getState().region?.rgba).toBe(first.rgba);
    expect(failingBuffer.destroy).toHaveBeenCalledOnce();
    expect(rafCallbacks).toHaveLength(1);
  });

  it('requests before rendering when paused and never forces render while playing', () => {
    (timeManager.isPaused as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const calls: string[] = [];
    (engine.requestPixelRegion as ReturnType<typeof vi.fn>).mockImplementation((id, x, y) => {
      calls.push('request'); queued.push([id, x, y]); return true;
    });
    (engine.render as ReturnType<typeof vi.fn>).mockImplementation(() => calls.push('render'));
    enableAt();
    expect(calls).toEqual(['request', 'render']);
    (timeManager.isPaused as ReturnType<typeof vi.fn>).mockReturnValue(false);
    runFrame(34);
    expect(calls).toEqual(['request', 'render', 'request']);
  });

  it('retries rejected queues without advancing the cadence timestamp', () => {
    (engine.requestPixelRegion as ReturnType<typeof vi.fn>).mockReturnValueOnce(false).mockReturnValue(true);
    enableAt();
    runFrame(1);
    expect(engine.requestPixelRegion).toHaveBeenCalledTimes(2);
  });

  it('refreshes a locked target and lockToPosition only schedules its next read', () => {
    manager.setEnabled(true);
    manager.lockToPosition(123.8, 321.2);
    expect(queued).toEqual([]);
    runFrame(0);
    expect(queued).toEqual([[1, 123, 321]]);
    runFrame(34);
    expect(queued).toHaveLength(2);
  });

  it('publishes fresh animated bytes for a locked target at the 30fps cadence', () => {
    manager.setEnabled(true);
    manager.lockToPosition(123, 321);
    runFrame(0);
    const first = result(1, 123, 321, [1, 2, 3, 255]);
    requests.push(first);
    runFrame(1);
    runFrame(34);
    const second = result(2, 123, 321, [9, 8, 7, 255]);
    requests.push(second);
    runFrame(35);

    expect(manager.getState().canvasPosition).toEqual({ x: 123, y: 321 });
    expect(manager.getState().region?.rgba).toBe(second.rgba);
    expect(manager.getState().pixelRGB).toEqual({ r: 9, g: 8, b: 7 });
  });

  it('cancels and clears immediately on pointer exit, disable, replacement, and dispose', () => {
    enableAt();
    requests.push(result(1, 400, 300));
    runFrame(1);
    move(-1, -1);
    expect(manager.getState()).toMatchObject({ region: null, pixelRGB: null, canvasPosition: null });
    expect(engine.cancelPixelRegionRequests).toHaveBeenCalled();
    manager.setEnabled(false);
    manager.dispose();
    expect(engine.cancelPixelRegionRequests).toHaveBeenCalledTimes(3);
  });

  it('rejects a late pre-disable result after re-enabling a cleared inspector', () => {
    enableAt();
    requests.push(result(1, 400, 300, [1, 2, 3, 255]));
    runFrame(1);
    runFrame(34); // Queues request 2, which remains in flight.
    manager.setEnabled(false);
    expect(manager.getState()).toMatchObject({ region: null, pixelRGB: null, canvasPosition: null });

    manager.setEnabled(true);
    move(200, 100);
    runFrame(35); // Starts the new session with request 3.
    requests.push(result(2, 400, 300));
    runFrame(36);
    expect(manager.getState()).toMatchObject({ region: null, pixelRGB: null, canvasPosition: null });

    requests.push(result(3, 200, 100, [9, 8, 7, 255]));
    runFrame(37);

    expect(manager.getState().canvasPosition).toEqual({ x: 200, y: 100 });
    expect(manager.getState().pixelRGB).toEqual({ r: 9, g: 8, b: 7 });
  });

  it('drops the old target and late result when a rendering session is replaced', () => {
    enableAt();
    const replacementRequests: Array<[number, number, number]> = [];
    const replacementResults: PixelRegionResult[] = [result(1, 400, 300)];
    const replacement = {
      requestPixelRegion: vi.fn((id: number, x: number, y: number) => {
        replacementRequests.push([id, x, y]);
        return true;
      }),
      collectPixelRegionResults: vi.fn(() => replacementResults.splice(0)),
      cancelPixelRegionRequests: vi.fn(),
      render: vi.fn(),
    } as unknown as RenderingEngine;

    manager.initialize(replacement, timeManager, {
      width: 800,
      height: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLCanvasElement);
    runFrame(34);

    expect(engine.cancelPixelRegionRequests).toHaveBeenCalled();
    expect(replacementRequests).toEqual([]);
    expect(manager.getState().region).toBeNull();

    move(200, 100);
    runFrame(35);
    expect(replacementRequests).toEqual([[2, 200, 100]]);
  });

  it('does not start duplicate RAF loops', () => {
    manager.setEnabled(true);
    manager.setEnabled(true);
    expect(rafCallbacks).toHaveLength(1);
  });
});
