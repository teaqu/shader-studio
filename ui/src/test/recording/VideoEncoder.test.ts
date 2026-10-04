import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { automaticVideoBitrate, MAX_VIDEO_BITRATE, MIN_VIDEO_BITRATE, VideoEncoderWrapper } from '../../lib/recording/VideoEncoder';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), add: vi.fn(), finalize: vi.fn(), cancel: vi.fn(), close: vi.fn(),
  sampleClose: vi.fn(), canEncode: vi.fn(), addTrack: vi.fn(),
  target: { buffer: new ArrayBuffer(4) as ArrayBuffer | null },
  config: null as Record<string, unknown> | null,
  samples: [] as { timestamp: number; duration: number }[],
  format: '',
}));
vi.mock('mediabunny', () => ({
  Quality: class {
    constructor(readonly options: unknown) {}
  },
  Mp4OutputFormat: class {
    constructor() {
      mocks.format = 'mp4';
    }
  },
  WebMOutputFormat: class {
    constructor() {
      mocks.format = 'webm';
    }
  },
  BufferTarget: class {
    constructor() {
      return mocks.target;
    }
  },
  Output: class {
    state = 'started';
    start = mocks.start; finalize = mocks.finalize; cancel = mocks.cancel;
    addVideoTrack = mocks.addTrack;
  },
  VideoSampleSource: class {
    add = mocks.add; close = mocks.close;
    constructor(config: Record<string, unknown>) {
      mocks.config = config;
    }
  },
  VideoSample: class {
    close = mocks.sampleClose;
    constructor(_canvas: unknown, options: { timestamp: number; duration: number }) {
      mocks.samples.push(options);
    }
  },
  canEncodeVideo: mocks.canEncode,
}));
afterEach(() => vi.unstubAllGlobals());
const options = { width: 640, height: 360, fps: 30, format: 'webm' as const };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.target.buffer = new ArrayBuffer(4);
  mocks.samples = [];
  mocks.start.mockResolvedValue(undefined);
  mocks.add.mockResolvedValue(undefined);
  mocks.finalize.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
  mocks.canEncode.mockResolvedValue(true);
  vi.stubGlobal('VideoEncoder', {});
});

describe('Mediabunny Render exports', () => {
  it.each(['mp4', 'webm'] as const)('encodes and finalizes %s with the matching container', async format => {
    const wrapper = new VideoEncoderWrapper({ ...options, format });
    await wrapper.addFrame(document.createElement('canvas'), 0);
    const blob = await wrapper.finish();
    expect(mocks.format).toBe(format);
    expect(mocks.config).toMatchObject({ codec: format === 'mp4' ? 'avc' : 'vp8', keyFrameInterval: 2 });
    expect(mocks.config?.quality).toMatchObject({ options: { bitrate: automaticVideoBitrate(options), bitrateMode: 'variable' } });
    expect(mocks.addTrack).toHaveBeenCalledWith(expect.anything(), { frameRate: 30 });
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(blob.type).toBe(`video/${format}`);
    expect(blob.size).toBe(4);
    await wrapper.close();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('preserves explicit bitrate', async () => {
    const wrapper = new VideoEncoderWrapper({ ...options, bitrate: 10_000_000 });
    await wrapper.addFrame(document.createElement('canvas'), 0);
    expect(mocks.config?.quality).toMatchObject({ options: { bitrate: 10_000_000 } });
  });
  it('converts microseconds to seconds and supplies an explicit frame duration', async () => {
    const wrapper = new VideoEncoderWrapper({ ...options, fps: 24 });
    await wrapper.addFrame(document.createElement('canvas'), 41667);
    expect(mocks.samples).toEqual([{ timestamp: 0.041667, duration: 1 / 24 }]);
    expect(mocks.sampleClose).toHaveBeenCalledOnce();
  });
  it('waits for output startup before accepting a frame', async () => {
    let start!: () => void;
    mocks.start.mockReturnValue(new Promise<void>(resolve => {
      start = resolve;
    }));
    const wrapper = new VideoEncoderWrapper(options);
    const pending = wrapper.addFrame(document.createElement('canvas'), 0);
    await Promise.resolve();
    expect(mocks.add).not.toHaveBeenCalled();
    start();
    await pending;
    expect(mocks.add).toHaveBeenCalledOnce();
  });
  it('propagates frame backpressure and releases the sample afterward', async () => {
    let ready!: () => void;
    mocks.add.mockReturnValue(new Promise<void>(resolve => {
      ready = resolve;
    }));
    const wrapper = new VideoEncoderWrapper(options);
    const pending = wrapper.addFrame(document.createElement('canvas'), 0);
    await Promise.resolve();
    expect(mocks.sampleClose).not.toHaveBeenCalled();
    ready();
    await pending;
    expect(mocks.sampleClose).toHaveBeenCalledOnce();
  });
  it('releases the sample when encoding fails', async () => {
    mocks.add.mockRejectedValue(new Error('encoder failed'));
    const wrapper = new VideoEncoderWrapper(options);
    await expect(wrapper.addFrame(document.createElement('canvas'), 0)).rejects.toThrow('encoder failed');
    expect(mocks.sampleClose).toHaveBeenCalledOnce();
    await wrapper.close();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it('surfaces startup errors and cancels without an unhandled rejection', async () => {
    mocks.start.mockRejectedValue(new Error('startup failed'));
    const wrapper = new VideoEncoderWrapper(options);
    await expect(wrapper.addFrame(document.createElement('canvas'), 0)).rejects.toThrow('startup failed');
    await wrapper.close();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it('snapshots before startup yields and releases a pending frame on cancellation', async () => {
    let start!: () => void;
    mocks.start.mockReturnValue(new Promise<void>(resolve => {
      start = resolve;
    }));
    const wrapper = new VideoEncoderWrapper(options);
    const pending = wrapper.addFrame(document.createElement('canvas'), 0);
    expect(mocks.samples).toHaveLength(1);
    const closed = wrapper.close();
    const rejected = expect(pending).rejects.toThrow('closed');
    start();
    await rejected;
    await closed;
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.sampleClose).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it('cancels an unfinished output only once', async () => {
    const wrapper = new VideoEncoderWrapper(options);
    await wrapper.close();
    await wrapper.close();
    expect(mocks.cancel).toHaveBeenCalledOnce();
    await expect(wrapper.addFrame(document.createElement('canvas'), 0)).rejects.toThrow('closed');
    await expect(wrapper.finish()).rejects.toThrow('closed');
  });
  it('surfaces finalization failure and allows resource cleanup', async () => {
    mocks.finalize.mockRejectedValue(new Error('finalize failed'));
    const wrapper = new VideoEncoderWrapper(options);
    await expect(wrapper.finish()).rejects.toThrow('finalize failed');
    await wrapper.close();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it('rejects missing or empty finalized data', async () => {
    for (const buffer of [null, new ArrayBuffer(0)]) {
      mocks.target.buffer = buffer;
      const wrapper = new VideoEncoderWrapper(options);
      await expect(wrapper.finish()).rejects.toThrow('no video data');
    }
  });
  it('preserves the original failure when cancellation itself fails', async () => {
    mocks.cancel.mockRejectedValue(new Error('cancel failed'));
    const wrapper = new VideoEncoderWrapper(options);
    await expect(wrapper.close()).resolves.toBeUndefined();
  });
});

describe('Render quality preflight', () => {
  it('budgets high-detail video and caps unsafe bitrates', () => {
    expect(automaticVideoBitrate(options)).toBe(34_560_000);
    expect(automaticVideoBitrate({ width: 16, height: 16, fps: 1 })).toBe(MIN_VIDEO_BITRATE);
    expect(automaticVideoBitrate({ width: 7680, height: 4320, fps: 120 })).toBe(MAX_VIDEO_BITRATE);
  });
  it.each(['mp4', 'webm'] as const)('checks %s with the same Mediabunny configuration used to encode', async format => {
    await expect(VideoEncoderWrapper.supportedBitrate({ ...options, format })).resolves.toBe(automaticVideoBitrate(options));
    expect(mocks.canEncode).toHaveBeenCalledWith(format === 'mp4' ? 'avc' : 'vp8', {
      width: 640, height: 360, frameRate: 30,
      quality: expect.objectContaining({ options: { bitrate: 34_560_000, bitrateMode: 'variable' } }),
    });
  });
  it('halves bitrate until supported', async () => {
    mocks.canEncode.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    await expect(VideoEncoderWrapper.supportedBitrate(options)).resolves.toBe(8_640_000);
    expect(mocks.canEncode).toHaveBeenCalledTimes(3);
  });
  it('rejects when every bitrate is unsupported or the support check throws', async () => {
    for (const check of [() => Promise.resolve(false), () => Promise.reject(new Error('invalid config'))]) {
      mocks.canEncode.mockImplementation(check);
      await expect(VideoEncoderWrapper.supportedBitrate(options)).rejects.toThrow('WEBM export at 640×360, 30 fps is not supported');
    }
  });
  it('rejects missing WebCodecs', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    await expect(VideoEncoderWrapper.supportedBitrate(options)).rejects.toThrow('WebCodecs unavailable');
    expect(mocks.canEncode).not.toHaveBeenCalled();
  });
});
