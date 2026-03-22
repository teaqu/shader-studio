import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSubscribe,
  mockCaptureScreenshot,
  mockRecord,
  mockCancel,
} = vi.hoisted(() => ({
  mockSubscribe: vi.fn((cb: any) => {
    cb({ isRecording: false });
    return () => {};
  }),
  mockCaptureScreenshot: vi.fn(() => Promise.resolve(new Blob(['img'], { type: 'image/png' }))),
  mockRecord: vi.fn(() => Promise.resolve(new Blob(['vid'], { type: 'video/webm' }))),
  mockCancel: vi.fn(),
}));

vi.mock('../lib/stores/recordingStore', () => ({
  recordingStore: {
    subscribe: mockSubscribe,
    startRecording: vi.fn(),
    updateProgress: vi.fn(),
    setFinalizing: vi.fn(),
    setError: vi.fn(),
    setPreviewCanvas: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('../lib/recording/ShaderRecorder', () => ({
  ShaderRecorder: vi.fn(() => ({
    captureScreenshot: mockCaptureScreenshot,
    record: mockRecord,
    cancel: mockCancel,
  })),
}));

import { RecordingManager } from '../lib/RecordingManager';
import type { ShaderInfo } from '../lib/recording/types';

const defaultContext: ShaderInfo = {
  code: 'void mainImage(out vec4 o, in vec2 uv) { o = vec4(1.0); }',
  config: null,
  path: '/test/shader.glsl',
  buffers: {},
};

describe('RecordingManager', () => {
  let manager: RecordingManager;
  let getContext: ReturnType<typeof vi.fn>;
  let sendFile: ReturnType<typeof vi.fn>;
  let onStateChanged: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getContext = vi.fn(() => defaultContext);
    sendFile = vi.fn();
    onStateChanged = vi.fn();
    manager = new RecordingManager(getContext, sendFile, onStateChanged);
  });

  describe('constructor', () => {
    it('should subscribe to recordingStore', () => {
      expect(mockSubscribe).toHaveBeenCalled();
    });

    it('should call onStateChanged with initial recording state', () => {
      expect(onStateChanged).toHaveBeenCalledWith(false);
    });

    it('should work without onStateChanged callback', () => {
      expect(() => new RecordingManager(getContext, sendFile)).not.toThrow();
    });
  });

  describe('isRecording', () => {
    it('should return false initially', () => {
      expect(manager.isRecording).toBe(false);
    });
  });

  describe('screenshot', () => {
    it('should call captureScreenshot with shader context', async () => {
      await manager.screenshot({ format: 'png', width: 800, height: 600 });

      expect(getContext).toHaveBeenCalled();
      expect(mockCaptureScreenshot).toHaveBeenCalledWith(
        { format: 'png', width: 800, height: 600 },
        defaultContext,
      );
    });

    it('should call sendFile with png blob', async () => {
      await manager.screenshot({ format: 'png', width: 800, height: 600 });

      expect(sendFile).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining('.png'),
        { PNG: ['png'] },
      );
    });

    it('should call sendFile with jpeg blob', async () => {
      await manager.screenshot({ format: 'jpeg', width: 800, height: 600 });

      expect(sendFile).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining('.jpg'),
        { JPEG: ['jpg'] },
      );
    });

    it('should pass custom time to captureScreenshot', async () => {
      await manager.screenshot({ format: 'png', width: 800, height: 600, time: 5.0 });

      expect(mockCaptureScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ time: 5.0 }),
        defaultContext,
      );
    });

    it('should not throw on screenshot error', async () => {
      mockCaptureScreenshot.mockRejectedValueOnce(new Error('fail'));
      await expect(manager.screenshot({ format: 'png', width: 800, height: 600 })).resolves.not.toThrow();
    });

    it('should not call sendFile on screenshot error', async () => {
      mockCaptureScreenshot.mockRejectedValueOnce(new Error('fail'));
      await manager.screenshot({ format: 'png', width: 800, height: 600 });
      expect(sendFile).not.toHaveBeenCalled();
    });
  });

  describe('record', () => {
    const baseConfig = {
      format: 'webm' as const,
      duration: 5,
      startTime: 0,
      fps: 30,
      width: 800,
      height: 600,
    };

    it('should call record with shader context', async () => {
      await manager.record(baseConfig);

      expect(getContext).toHaveBeenCalled();
      expect(mockRecord).toHaveBeenCalledWith(baseConfig, defaultContext);
    });

    it('should call sendFile with webm blob', async () => {
      await manager.record(baseConfig);

      expect(sendFile).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining('.webm'),
        { 'WebM Video': ['webm'] },
      );
    });

    it('should call sendFile with mp4 label for mp4 format', async () => {
      await manager.record({ ...baseConfig, format: 'mp4' });

      expect(sendFile).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining('.mp4'),
        { 'MP4 Video': ['mp4'] },
      );
    });

    it('should call sendFile with gif label for gif format', async () => {
      await manager.record({ ...baseConfig, format: 'gif' });

      expect(sendFile).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringContaining('.gif'),
        { GIF: ['gif'] },
      );
    });

    it('should not throw on recording error', async () => {
      mockRecord.mockRejectedValueOnce(new Error('encode fail'));
      await expect(manager.record(baseConfig)).resolves.not.toThrow();
    });

    it('should silently handle cancellation errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockRecord.mockRejectedValueOnce(new Error('Recording cancelled'));
      await manager.record(baseConfig);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log non-cancellation errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockRecord.mockRejectedValueOnce(new Error('encode fail'));
      await manager.record(baseConfig);
      expect(consoleSpy).toHaveBeenCalledWith('Recording failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('should not call sendFile on recording error', async () => {
      mockRecord.mockRejectedValueOnce(new Error('fail'));
      await manager.record(baseConfig);
      expect(sendFile).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should call recorder cancel', () => {
      manager.cancel();
      expect(mockCancel).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should unsubscribe from recording store', () => {
      const unsub = vi.fn();
      mockSubscribe.mockReturnValueOnce(unsub);
      const m = new RecordingManager(getContext, sendFile);
      m.dispose();
      expect(unsub).toHaveBeenCalled();
    });

    it('should not throw if called twice', () => {
      manager.dispose();
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe('default filename', () => {
    it('should include current date in screenshot filename', async () => {
      await manager.screenshot({ format: 'png', width: 100, height: 100 });
      const filename = sendFile.mock.calls[0][1];
      const today = new Date().toISOString().slice(0, 10);
      expect(filename).toContain(today);
    });

    it('should include current date in recording filename', async () => {
      await manager.record({ format: 'webm', duration: 1, startTime: 0, fps: 30, width: 100, height: 100 });
      const filename = sendFile.mock.calls[0][1];
      const today = new Date().toISOString().slice(0, 10);
      expect(filename).toContain(today);
    });
  });
});
