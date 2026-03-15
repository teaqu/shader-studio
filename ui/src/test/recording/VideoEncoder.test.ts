import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock muxer libraries
const mockWebMAddVideoChunk = vi.fn();
const mockWebMFinalize = vi.fn();
const mockMP4AddVideoChunk = vi.fn();
const mockMP4Finalize = vi.fn();

vi.mock('webm-muxer', () => ({
  Muxer: vi.fn(() => ({
    addVideoChunk: mockWebMAddVideoChunk,
    finalize: mockWebMFinalize,
    target: { buffer: new ArrayBuffer(100) },
  })),
  ArrayBufferTarget: vi.fn(),
}));

vi.mock('mp4-muxer', () => ({
  Muxer: vi.fn(() => ({
    addVideoChunk: mockMP4AddVideoChunk,
    finalize: mockMP4Finalize,
    target: { buffer: new ArrayBuffer(200) },
  })),
  ArrayBufferTarget: vi.fn(),
}));

// Mock VideoEncoder and VideoFrame globals
const mockEncode = vi.fn();
const mockFlush = vi.fn(() => Promise.resolve());
const mockClose = vi.fn();
let capturedOutput: (chunk: any, meta: any) => void;

(globalThis as any).VideoEncoder = vi.fn(function (init: any) {
  capturedOutput = init.output;
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

import { VideoEncoderWrapper } from '../../lib/recording/VideoEncoder';
import { Muxer as WebMMuxer } from 'webm-muxer';
import { Muxer as MP4Muxer } from 'mp4-muxer';

describe('VideoEncoderWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
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

    it('should use default bitrate of 5Mbps', () => {
      new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const configureCall = (globalThis as any).VideoEncoder.mock.results[0].value.configure;
      expect(configureCall).toHaveBeenCalledWith(
        expect.objectContaining({ bitrate: 5_000_000 }),
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
    it('should create VideoFrame and encode it', () => {
      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const canvas = document.createElement('canvas');

      wrapper.addFrame(canvas, 0);

      expect((globalThis as any).VideoFrame).toHaveBeenCalledWith(canvas, { timestamp: 0 });
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
      (globalThis as any).VideoFrame = vi.fn(() => ({
        timestamp: 0,
        close: mockFrameClose,
      }));

      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      const canvas = document.createElement('canvas');
      wrapper.addFrame(canvas, 0);

      expect(mockFrameClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush', () => {
    it('should flush the encoder', async () => {
      const wrapper = new VideoEncoderWrapper({ width: 800, height: 600, fps: 30, format: 'webm' });
      await wrapper.flush();
      expect(mockFlush).toHaveBeenCalledTimes(1);
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
});
