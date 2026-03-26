import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

// Polyfill ImageData for jsdom (used by GIF recording path)
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? (data.length / (4 * width));
    }
  };
}

// Mock recordingStore
const mockStartRecording = vi.fn();
const mockUpdateProgress = vi.fn();
const mockSetFinalizing = vi.fn();
const mockReset = vi.fn();
const mockSetPreviewCanvas = vi.fn();

vi.mock('../../lib/stores/recordingStore', () => ({
  recordingStore: {
    startRecording: (...args: any[]) => mockStartRecording(...args),
    updateProgress: (...args: any[]) => mockUpdateProgress(...args),
    setFinalizing: () => mockSetFinalizing(),
    reset: () => mockReset(),
    setPreviewCanvas: (...args: any[]) => mockSetPreviewCanvas(...args),
  },
}));

// Mock GifEncoder
const mockGifAddFrame = vi.fn();
const mockGifFinish = vi.fn(() => Promise.resolve(new Uint8Array([71, 73, 70]))); // "GIF"
const mockGifCancel = vi.fn();

vi.mock('../../lib/recording/GifEncoder', () => ({
  GifEncoderWrapper: vi.fn(() => ({
    addFrame: mockGifAddFrame,
    finish: mockGifFinish,
    cancel: mockGifCancel,
  })),
}));

// Mock VideoEncoder
const mockVideoAddFrame = vi.fn();
const mockVideoFlush = vi.fn(() => Promise.resolve());
const mockVideoFinish = vi.fn(() => Promise.resolve(new Blob(['video'], { type: 'video/webm' })));

vi.mock('../../lib/recording/VideoEncoder', () => ({
  VideoEncoderWrapper: vi.fn(() => ({
    addFrame: mockVideoAddFrame,
    flush: mockVideoFlush,
    finish: mockVideoFinish,
  })),
}));

// Mock RenderingEngine
const mockInitialize = vi.fn();
const mockHandleCanvasResize = vi.fn();
const mockCompileShaderPipeline = vi.fn(() => Promise.resolve({ success: true }));
const mockRenderForCapture = vi.fn();
const mockDispose = vi.fn();
const mockSetTime = vi.fn();
const mockSetFrame = vi.fn();
const mockSetDeltaTime = vi.fn();
const mockGetTimeManager = vi.fn(() => ({
  setTime: mockSetTime,
  setFrame: mockSetFrame,
  setDeltaTime: mockSetDeltaTime,
}));

vi.mock('../../../../rendering/src/RenderingEngine', () => ({
  RenderingEngine: vi.fn(() => ({
    initialize: mockInitialize,
    handleCanvasResize: mockHandleCanvasResize,
    compileShaderPipeline: mockCompileShaderPipeline,
    renderForCapture: mockRenderForCapture,
    dispose: mockDispose,
    getTimeManager: mockGetTimeManager,
  })),
}));

import { ShaderRecorder, type RecordingConfig, type ShaderInfo, type ScreenshotConfig } from '../../lib/recording/ShaderRecorder';
import { VideoEncoderWrapper } from '../../lib/recording/VideoEncoder';
import { GifEncoderWrapper } from '../../lib/recording/GifEncoder';

const shaderInfo: ShaderInfo = {
  code: 'void mainImage(out vec4 o, in vec2 uv) { o = vec4(1.0); }',
  config: null,
  path: '/test/shader.glsl',
  buffers: {},
};

describe('ShaderRecorder', () => {
  let recorder: ShaderRecorder;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    recorder = new ShaderRecorder();
    // Mock document.createElement to return a canvas-like object
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      style: { position: '', left: '', top: '', pointerEvents: '' },
      remove: vi.fn(),
      getContext: vi.fn(() => ({
        readPixels: vi.fn(),
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
      })),
      toBlob: vi.fn((_cb: any, _type: string, _quality?: number) => {
        _cb(new Blob(['image'], { type: 'image/png' }));
      }),
    } as any);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('captureScreenshot', () => {
    it('should create offscreen engine at requested resolution', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 1920, height: 1080 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockInitialize).toHaveBeenCalledWith(expect.anything(), true);
      expect(mockHandleCanvasResize).toHaveBeenCalledWith(1920, 1080);
    });

    it('should compile shader pipeline', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockCompileShaderPipeline).toHaveBeenCalledWith(
        shaderInfo.code,
        shaderInfo.config,
        shaderInfo.path,
        shaderInfo.buffers,
      );
    });

    it('should render at specified time', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600, time: 5.0 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockSetTime).toHaveBeenCalledWith(5.0);
      expect(mockRenderForCapture).toHaveBeenCalled();
    });

    it('should default to time 0 when no time specified', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockSetTime).toHaveBeenCalledWith(0);
    });

    it('should dispose offscreen engine after capture', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      await recorder.captureScreenshot(config, shaderInfo);

      expect(mockDispose).toHaveBeenCalled();
      expect(mockSetPreviewCanvas).toHaveBeenCalledWith(null);
    });

    it('should dispose offscreen engine even on error', async () => {
      mockCompileShaderPipeline.mockResolvedValueOnce({ success: false, errors: ['bad shader'] } as any);
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };

      await expect(recorder.captureScreenshot(config, shaderInfo)).rejects.toThrow('Shader compilation failed');
      expect(mockDispose).toHaveBeenCalled();
    });

    it('should return a Blob', async () => {
      const config: ScreenshotConfig = { format: 'png', width: 800, height: 600 };
      const blob = await recorder.captureScreenshot(config, shaderInfo);
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  describe('record', () => {
    const baseConfig: RecordingConfig = {
      format: 'webm',
      duration: 0.1,
      startTime: 0,
      fps: 10,
      width: 800,
      height: 600,
    };

    async function rec(config: RecordingConfig) {
      const p = recorder.record(config, shaderInfo);
      await vi.runAllTimersAsync();
      return p;
    }

    it('should create offscreen engine and compile shader', async () => {
      await rec(baseConfig);

      expect(mockInitialize).toHaveBeenCalledWith(expect.anything(), true);
      expect(mockCompileShaderPipeline).toHaveBeenCalled();
    });

    it('should set preview canvas for live preview', async () => {
      await rec(baseConfig);

      expect(mockSetPreviewCanvas).toHaveBeenCalledWith(expect.anything());
    });

    it('should start recording in store with correct format and frame count', async () => {
      await rec({ ...baseConfig, format: 'mp4', duration: 5, fps: 30 });

      // 5 seconds * 30 fps = 150 frames (Math.ceil)
      expect(mockStartRecording).toHaveBeenCalledWith('mp4', 150);
    });

    it('should round dimensions to even numbers for MP4', async () => {
      await rec({ ...baseConfig, format: 'mp4', width: 801, height: 601 });

      expect(mockHandleCanvasResize).toHaveBeenCalledWith(802, 602);
    });

    it('should not round dimensions for WebM', async () => {
      await rec({ ...baseConfig, format: 'webm', width: 801, height: 601 });

      expect(mockHandleCanvasResize).toHaveBeenCalledWith(801, 601);
    });

    it('should not round even dimensions for MP4', async () => {
      await rec({ ...baseConfig, format: 'mp4', width: 1920, height: 1080 });

      expect(mockHandleCanvasResize).toHaveBeenCalledWith(1920, 1080);
    });

    it('should not round dimensions for GIF', async () => {
      await rec({ ...baseConfig, format: 'gif', width: 801, height: 601 });

      expect(mockHandleCanvasResize).toHaveBeenCalledWith(801, 601);
    });

    it('should use VideoEncoderWrapper for webm format', async () => {
      await rec({ ...baseConfig, format: 'webm' });
      expect(VideoEncoderWrapper).toHaveBeenCalled();
      expect(GifEncoderWrapper).not.toHaveBeenCalled();
    });

    it('should use VideoEncoderWrapper for mp4 format', async () => {
      await rec({ ...baseConfig, format: 'mp4' });
      expect(VideoEncoderWrapper).toHaveBeenCalled();
      expect(GifEncoderWrapper).not.toHaveBeenCalled();
    });

    it('should use GifEncoderWrapper for gif format', async () => {
      await rec({ ...baseConfig, format: 'gif' });
      expect(GifEncoderWrapper).toHaveBeenCalled();
      expect(VideoEncoderWrapper).not.toHaveBeenCalled();
    });

    it('should render correct number of frames', async () => {
      await rec({ ...baseConfig, duration: 1, fps: 10 });

      // 1 second * 10 fps = 10 frames
      expect(mockRenderForCapture).toHaveBeenCalledTimes(10);
    });

    it('should set correct time for each frame during video recording', async () => {
      await rec({ ...baseConfig, duration: 0.1, fps: 10, startTime: 5.0 });

      // 1 frame: time = 5.0 + 0 * 0.1 = 5.0
      expect(mockSetTime).toHaveBeenCalledWith(5.0);
    });

    it('should update progress during recording', async () => {
      await rec({ ...baseConfig, duration: 0.5, fps: 10 });

      // 5 frames, progress updated each frame
      expect(mockUpdateProgress).toHaveBeenCalledTimes(5);
      expect(mockUpdateProgress).toHaveBeenLastCalledWith(5, 5);
    });

    it('should set finalizing state before finishing', async () => {
      await rec(baseConfig);
      expect(mockSetFinalizing).toHaveBeenCalled();
    });

    it('should flush video encoder periodically', async () => {
      // With fps=30, flushInterval = max(4, ceil(30/2)) = 15
      // For 30 frames (1s), flush at frame 14, 29
      await rec({ ...baseConfig, duration: 1, fps: 30 });

      expect(mockVideoFlush).toHaveBeenCalled();
    });

    it('should dispose offscreen engine after recording', async () => {
      await rec(baseConfig);

      expect(mockDispose).toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();
      expect(mockSetPreviewCanvas).toHaveBeenCalledWith(null);
    });

    it('should dispose offscreen engine on compilation error', async () => {
      mockCompileShaderPipeline.mockResolvedValueOnce({ success: false, errors: ['error'] } as any);

      await expect(recorder.record(baseConfig, shaderInfo)).rejects.toThrow('Shader compilation failed');
      expect(mockDispose).toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();
    });

    it('should return a Blob', async () => {
      const blob = await rec(baseConfig);
      expect(blob).toBeInstanceOf(Blob);
    });
  });

  describe('cancel', () => {
    it('should stop recording when cancel is called', async () => {
      // We need to test cancellation mid-recording
      // Set up a long recording that we'll cancel during
      let frameCount = 0;
      mockRenderForCapture.mockImplementation(() => {
        frameCount++;
        if (frameCount === 3) {
          recorder.cancel();
        }
      });

      const config: RecordingConfig = {
        format: 'webm',
        duration: 10,
        startTime: 0,
        fps: 30,
        width: 800,
        height: 600,
      };

      const p = recorder.record(config, shaderInfo);
      p.catch(() => {});
      await vi.runAllTimersAsync();
      await expect(p).rejects.toThrow('Recording cancelled');

      // Should have rendered only a few frames before cancellation
      expect(mockRenderForCapture.mock.calls.length).toBeLessThan(300);
    });
  });
});
