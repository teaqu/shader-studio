import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock muxer libraries
const mockWebMAddVideoChunk = vi.fn();
const mockWebMFinalize = vi.fn();
const mockMP4AddVideoChunk = vi.fn();
const mockMP4Finalize = vi.fn();

vi.mock('webm-muxer', () => ({
  Muxer: vi.fn(function () {
    return ({
      addVideoChunk: mockWebMAddVideoChunk,
      finalize: mockWebMFinalize,
      target: { buffer: new ArrayBuffer(100) },
    });
  }),
  ArrayBufferTarget: vi.fn(),
}));

vi.mock('mp4-muxer', () => ({
  Muxer: vi.fn(function () {
    return ({
      addVideoChunk: mockMP4AddVideoChunk,
      finalize: mockMP4Finalize,
      target: { buffer: new ArrayBuffer(200) },
    });
  }),
  ArrayBufferTarget: vi.fn(),
}));

// Mock VideoEncoder and VideoFrame globals
const mockEncode = vi.fn();
const mockFlush = vi.fn(() => Promise.resolve());
const mockClose = vi.fn();
let capturedOutput: (chunk: any, meta: any) => void;
let capturedError: (error: DOMException) => void;

(globalThis as any).VideoEncoder = vi.fn(function (init: any) {
  capturedOutput = init.output;
  capturedError = init.error;
  return {
    configure: vi.fn(),
    encode: mockEncode,
    flush: mockFlush,
    close: mockClose,
  };
});

(globalThis as any).VideoFrame = vi.fn(function (_canvas: any, opts: any) {
  return { timestamp: opts.timestamp, close: vi.fn() };
});

import {
  automaticVideoBitrate,
  MAX_VIDEO_BITRATE,
  MIN_VIDEO_BITRATE,
  videoEncoderConfig,
  VideoEncoderWrapper,
} from '../../lib/recording/VideoEncoder';
import { Muxer as WebMMuxer } from 'webm-muxer';
import { Muxer as MP4Muxer } from 'mp4-muxer';

describe('VideoEncoderWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('sets the automatic bitrate ceiling at 3 bits per pixel for every codec', () => {
      expect(automaticVideoBitrate({ width: 640, height: 360, fps: 30 })).toBe(20_736_000);
      expect(automaticVideoBitrate({ width: 1280, height: 720, fps: 30 }))
        .toBeLessThan(automaticVideoBitrate({ width: 1920, height: 1080, fps: 30 }));
      expect(automaticVideoBitrate({ width: 1920, height: 1080, fps: 30 }))
        .toBeLessThan(automaticVideoBitrate({ width: 1920, height: 1080, fps: 60 }));
    });

    it('keeps the automatic bitrate between its floor and cap', () => {
      expect(automaticVideoBitrate({ width: 16, height: 16, fps: 1 })).toBe(MIN_VIDEO_BITRATE);
      expect(automaticVideoBitrate({ width: 7680, height: 4320, fps: 120 })).toBe(MAX_VIDEO_BITRATE);
    });

    it('encodes in variable-bitrate mode so the ceiling is only spent when needed', () => {
      expect(videoEncoderConfig({ width: 640, height: 360, fps: 30, format: 'webm' })).toMatchObject({
        codec: 'vp8',
        bitrate: 20_736_000,
        bitrateMode: 'variable',
      });
    });

    it('should create WebM muxer for webm format', () => {
      new VideoEncoderWrapper({ width: 1280, height: 720, fps: 30, format: 'webm' });
      expect(WebMMuxer).toHaveBeenCalledWith(
        expect.objectContaining({
          video: { codec: 'V_VP8', width: 1280, height: 720 },
        }),
      );
      expect(MP4Muxer).not.toHaveBeenCalled();
    });

    it('should create MP4 muxer for mp4 format', () => {
      new VideoEncoderWrapper({ width: 1920, height: 1080, fps: 30, format: 'mp4' });
      expect(MP4Muxer).toHaveBeenCalledWith(
        expect.objectContaining({
          video: { codec: 'avc', width: 1920, height: 1080 },
          fastStart: 'in-memory',
        }),
      );
    });

    it('should use VP8 codec for webm', () => {
      new VideoEncoderWrapper({ width: 640, height: 480, fps: 30, format: 'webm' });
      const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
      expect(configureCall).toHaveBeenCalledWith(
        expect.objectContaining({ codec: 'vp8' }),
      );
    });

    describe('AVC level selection for MP4', () => {
      it('should use level 3.1 (1f) for 720p and below', () => {
        // 1280x720 = 921600 pixels
        new VideoEncoderWrapper({ width: 1280, height: 720, fps: 30, format: 'mp4' });
        const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
        expect(configureCall).toHaveBeenCalledWith(
          expect.objectContaining({ codec: 'avc1.42001f' }),
        );
      });

      it('should use level 4.0 (28) for 1080p', () => {
        // 1920x1080 = 2073600 pixels
        new VideoEncoderWrapper({ width: 1920, height: 1080, fps: 30, format: 'mp4' });
        const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
        expect(configureCall).toHaveBeenCalledWith(
          expect.objectContaining({ codec: 'avc1.420028' }),
        );
      });

      it('should use level 5.1 (33) for 4K', () => {
        // 3840x2160 = 8294400 pixels
        new VideoEncoderWrapper({ width: 3840, height: 2160, fps: 30, format: 'mp4' });
        const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
        expect(configureCall).toHaveBeenCalledWith(
          expect.objectContaining({ codec: 'avc1.420033' }),
        );
      });

      it('should use level 3.1 for resolutions at exactly 921600 pixels', () => {
        // Exactly at the boundary: 1280*720 = 921600
        new VideoEncoderWrapper({ width: 1280, height: 720, fps: 30, format: 'mp4' });
        const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
        expect(configureCall).toHaveBeenCalledWith(
          expect.objectContaining({ codec: 'avc1.42001f' }),
        );
      });

      it('should use level 4.0 for resolutions just above 921600 pixels', () => {
        // 1281*720 = 922320 > 921600
        new VideoEncoderWrapper({ width: 1281, height: 720, fps: 30, format: 'mp4' });
        const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
        expect(configureCall).toHaveBeenCalledWith(
          expect.objectContaining({ codec: 'avc1.420028' }),
        );
      });
    });

    it('should use an automatic bitrate by default', () => {
      new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
      expect(configureCall).toHaveBeenCalledWith(
        expect.objectContaining({ bitrate: automaticVideoBitrate({ width: 800, height: 600, fps: 30 }) }),
      );
    });

    it('should use custom bitrate when provided', () => {
      new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm', bitrate: 10_000_000 });
      const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
      expect(configureCall).toHaveBeenCalledWith(
        expect.objectContaining({ bitrate: 10_000_000 }),
      );
    });

    it('should configure framerate', () => {
      new VideoEncoderWrapper({ width: 800, height: 600, fps: 60, format: 'webm' });
      const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
      expect(configureCall).toHaveBeenCalledWith(
        expect.objectContaining({ framerate: 60 }),
      );
    });
  });

  describe('addFrame', () => {
    it.each(['mp4', 'webm'] as const)('provides explicit frame duration for %s in browsers that do not infer it', (format) => {
      const wrapper = new VideoEncoderWrapper({ width: 640, height: 480, fps: 24, format });
      const canvas = document.createElement('canvas');
      wrapper.addFrame(canvas, 41667);
      expect(globalThis.VideoFrame).toHaveBeenCalledWith(canvas, {
        timestamp: 41667,
        duration: 41667,
      });
    });

    it('should create VideoFrame and encode it', () => {
      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const canvas = document.createElement('canvas');

      wrapper.addFrame(canvas, 0);

      expect((globalThis as any).VideoFrame).toHaveBeenCalledWith(canvas, { timestamp: 0, duration: 33333 });
      expect(mockEncode).toHaveBeenCalled();
    });

    it('should set keyFrame on first frame', () => {
      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const canvas = document.createElement('canvas');

      wrapper.addFrame(canvas, 0);

      expect(mockEncode).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ keyFrame: true }),
      );
    });

    it('should set keyFrame every 2 seconds worth of frames', () => {
      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const canvas = document.createElement('canvas');

      // Frame 0 is keyFrame (0 % 60 === 0)
      wrapper.addFrame(canvas, 0);
      expect(mockEncode).toHaveBeenLastCalledWith(
        expect.anything(),
        { keyFrame: true },
      );

      // Frames 1-59 are not keyFrames
      for (let i = 1; i < 60; i++) {
        wrapper.addFrame(canvas, i * 33333);
      }
      // Frame 59 should not be keyFrame
      expect(mockEncode).toHaveBeenLastCalledWith(
        expect.anything(),
        { keyFrame: false },
      );

      // Frame 60 is keyFrame again (60 % 60 === 0)
      wrapper.addFrame(canvas, 60 * 33333);
      expect(mockEncode).toHaveBeenLastCalledWith(
        expect.anything(),
        { keyFrame: true },
      );
    });

    it('should close the VideoFrame after encoding', () => {
      const mockFrameClose = vi.fn();
      (globalThis as any).VideoFrame = vi.fn(function () {
        return ({
          timestamp: 0,
          close: mockFrameClose,
        });
      });

      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const canvas = document.createElement('canvas');
      wrapper.addFrame(canvas, 0);

      expect(mockFrameClose).toHaveBeenCalledTimes(1);
    });

    it('closes the VideoFrame even when encode throws', () => {
      const mockFrameClose = vi.fn();
      (globalThis as any).VideoFrame = vi.fn(function () {
        return ({ timestamp: 0, close: mockFrameClose });
      });
      mockEncode.mockImplementationOnce(() => {
        throw new Error('InvalidStateError: encoder closed');
      });

      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      expect(() => wrapper.addFrame(document.createElement('canvas'), 0)).toThrow('encoder closed');
      expect(mockFrameClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush', () => {
    it('should flush the encoder', async () => {
      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      await wrapper.flush();
      expect(mockFlush).toHaveBeenCalledTimes(1);
    });

    it('surfaces asynchronous encoder failures', async () => {
      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      capturedError(new DOMException('Hardware encoder failed'));

      await expect(wrapper.flush()).rejects.toThrow('Hardware encoder failed');
    });
  });

  describe('finish', () => {
    it('should flush, close encoder, and finalize muxer for webm', async () => {
      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const blob = await wrapper.finish();

      expect(mockFlush).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      expect(mockWebMFinalize).toHaveBeenCalled();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('video/webm');
    });

    it('should flush, close encoder, and finalize muxer for mp4', async () => {
      const wrapper = new VideoEncoderWrapper({ width: 1920, height: 1080, fps: 30, format: 'mp4' });
      const blob = await wrapper.finish();

      expect(mockFlush).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      expect(mockMP4Finalize).toHaveBeenCalled();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('video/mp4');
    });
  });

  describe('supportedBitrate', () => {
    const options = { width: 1920, height: 1080, fps: 60, format: 'mp4' as const };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the global VideoEncoder is a test mock
    const encoderGlobal = () => (globalThis as any).VideoEncoder;

    afterEach(() => {
      delete encoderGlobal().isConfigSupported;
    });

    it('uses the automatic ceiling when the host accepts it', async () => {
      encoderGlobal().isConfigSupported = vi.fn(async () => ({ supported: true }));
      await expect(VideoEncoderWrapper.supportedBitrate(options)).resolves.toBe(automaticVideoBitrate(options));
    });

    it('halves the bitrate until the host accepts the configuration', async () => {
      const ceiling = automaticVideoBitrate(options);
      encoderGlobal().isConfigSupported = vi.fn(async (config: VideoEncoderConfig) => ({
        supported: (config.bitrate ?? 0) <= ceiling / 4,
      }));
      await expect(VideoEncoderWrapper.supportedBitrate(options)).resolves.toBe(Math.floor(Math.floor(ceiling / 2) / 2));
      expect(encoderGlobal().isConfigSupported).toHaveBeenCalledTimes(3);
    });

    it('treats a throwing support check as unsupported and rejects when nothing fits', async () => {
      encoderGlobal().isConfigSupported = vi.fn(async () => {
        throw new TypeError('invalid config');
      });
      await expect(VideoEncoderWrapper.supportedBitrate(options)).rejects.toThrow(
        'MP4 export at 1920×1080, 60 fps is not supported by this host',
      );
    });

    it('rejects when WebCodecs is unavailable', async () => {
      const saved = encoderGlobal();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- removing the test mock global
      delete (globalThis as any).VideoEncoder;
      try {
        await expect(VideoEncoderWrapper.supportedBitrate(options)).rejects.toThrow('WebCodecs unavailable');
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- restoring the test mock global
        (globalThis as any).VideoEncoder = saved;
      }
    });
  });
});
