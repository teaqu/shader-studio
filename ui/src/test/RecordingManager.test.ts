import type { FunctionMock } from './FunctionMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSubscribe,
  mockCaptureScreenshot,
  mockCaptureLiveScreenshot,
  mockRecordLive,
  mockStopLiveRecording,
  mockRecord,
  mockCancel,
  mockSetSaving,
  mockSetError,
  mockSetNotice,
  mockReset,
} = vi.hoisted(() => ({
  mockSubscribe: vi.fn((cb: any) => {
    cb({ isRecording: false });
    return () => {};
  }),
  mockCaptureScreenshot: vi.fn(() => Promise.resolve(new Blob(['img'], { type: 'image/png' }))),
  mockCaptureLiveScreenshot: vi.fn(() => Promise.resolve(new Blob(['live'], { type: 'image/png' }))),
  mockRecordLive: vi.fn(() => Promise.resolve(new Blob(['live-video'], { type: 'video/webm' }))),
  mockStopLiveRecording: vi.fn(),
  mockRecord: vi.fn(() => Promise.resolve(new Blob(['vid'], { type: 'video/webm' }))),
  mockCancel: vi.fn(),
  mockSetSaving: vi.fn(),
  mockSetError: vi.fn(),
  mockSetNotice: vi.fn(),
  mockReset: vi.fn(),
}));

vi.mock('../lib/stores/recordingStore', () => ({
  recordingStore: {
    subscribe: mockSubscribe,
    startRecording: vi.fn(),
    updateProgress: vi.fn(),
    setFinalizing: vi.fn(),
    setSaving: mockSetSaving,
    setError: mockSetError,
    setNotice: mockSetNotice,
    setPreviewCanvas: vi.fn(),
    reset: mockReset,
  },
}));

vi.mock('../lib/recording/ShaderRecorder', () => ({
  ShaderRecorder: vi.fn(function () {
    return ({
      captureScreenshot: mockCaptureScreenshot,
      captureLiveScreenshot: mockCaptureLiveScreenshot,
      recordLive: mockRecordLive,
      stopLiveRecording: mockStopLiveRecording,
      record: mockRecord,
      cancel: mockCancel,
    });
  }),
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
  let getContext: FunctionMock;
  let sendFile: FunctionMock;
  let onStateChanged: FunctionMock;

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
    it('uses the current engine for Live screenshots instead of building Render context', async () => {
      const liveEngine = { captureCurrentFrame: vi.fn() } as any;
      const liveManager = new RecordingManager(getContext, sendFile, onStateChanged, () => liveEngine);

      await liveManager.screenshot({ mode: 'live', format: 'png', width: 800, height: 600 });

      expect(mockCaptureLiveScreenshot).toHaveBeenCalledWith(
        { mode: 'live', format: 'png', width: 800, height: 600 },
        liveEngine,
      );
      expect(mockCaptureScreenshot).not.toHaveBeenCalled();
      expect(getContext).toHaveBeenCalledOnce();
    });

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

    it('surfaces screenshot failures in the recording panel', async () => {
      mockCaptureScreenshot.mockRejectedValueOnce(new Error('Readback failed'));

      await manager.screenshot({ format: 'png', width: 800, height: 600 });

      expect(mockSetError).toHaveBeenCalledWith('Readback failed');
    });

    it('shows saving state until the host confirms the file was saved', async () => {
      const save = Promise.withResolvers<void>();
      sendFile.mockReturnValueOnce(save.promise);
      const screenshot = manager.screenshot({ format: 'png', width: 800, height: 600 });
      await vi.waitFor(() => expect(mockSetSaving).toHaveBeenCalledWith('png'));
      expect(mockReset).not.toHaveBeenCalled();

      save.resolve();
      await screenshot;

      expect(mockReset).toHaveBeenCalled();
    });

    it('surfaces host save failures', async () => {
      sendFile.mockRejectedValueOnce(new Error('Disk full'));

      await manager.screenshot({ format: 'png', width: 800, height: 600 });

      expect(mockSetError).toHaveBeenCalledWith('Disk full');
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

    it('surfaces video encoder failures in the recording panel', async () => {
      mockRecord.mockRejectedValueOnce(new Error('Encoder crashed'));

      await manager.record(baseConfig);

      expect(mockSetError).toHaveBeenCalledWith('Encoder crashed');
    });

    it('resets panel state after user cancellation', async () => {
      mockRecord.mockRejectedValueOnce(new Error('Recording cancelled'));

      await manager.record(baseConfig);

      expect(mockReset).toHaveBeenCalled();
      expect(mockSetError).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should call recorder cancel', () => {
      manager.cancel();
      expect(mockCancel).toHaveBeenCalled();
    });
  });

  describe('Live lifecycle', () => {
    it('stops and saves a Live recording the app has to end, then explains why', async () => {
      let finishRecording!: (blob: Blob) => void;
      mockRecordLive.mockImplementationOnce(() => new Promise<Blob>((resolve) => {
        finishRecording = resolve;
      }));
      mockStopLiveRecording.mockImplementationOnce(() => finishRecording(new Blob(['kept'], { type: 'video/webm' })));
      const liveManager = new RecordingManager(getContext, sendFile, onStateChanged, () => ({}) as any);
      (liveManager as any)._isLive = true;
      const recording = liveManager.record({
        mode: 'live', format: 'webm', duration: 5, startTime: 0, fps: 30, width: 800, height: 600,
      });
      liveManager.endLiveRecording('Live recording stopped because a different shader was opened.');
      await recording;

      expect(mockStopLiveRecording).toHaveBeenCalledOnce();
      expect(mockCancel).not.toHaveBeenCalled();
      expect(sendFile).toHaveBeenCalledOnce();
      expect(mockSetNotice).toHaveBeenCalledWith('Live recording stopped because a different shader was opened.');
      expect(mockSetError).not.toHaveBeenCalled();
    });

    it('still discards when the user chooses Discard', async () => {
      mockRecordLive.mockRejectedValueOnce(new Error('Recording cancelled'));
      const liveManager = new RecordingManager(getContext, sendFile, onStateChanged, () => ({}) as any);
      await liveManager.record({
        mode: 'live', format: 'webm', duration: 5, startTime: 0, fps: 30, width: 800, height: 600,
      });

      expect(sendFile).not.toHaveBeenCalled();
      expect(mockReset).toHaveBeenCalled();
      expect(mockSetNotice).not.toHaveBeenCalled();
    });

    it('ignores endLiveRecording when no Live recording is running', () => {
      manager.endLiveRecording('ignored');
      expect(mockStopLiveRecording).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should unsubscribe from recording store', () => {
      const unsub = vi.fn();
      mockSubscribe.mockReturnValueOnce(unsub);
      const m = new RecordingManager(getContext, sendFile);
      m.dispose();
      expect(unsub).toHaveBeenCalled();
      expect(mockCancel).toHaveBeenCalled();
    });

    it('should not throw if called twice', () => {
      manager.dispose();
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe('default filename', () => {
    it('uses the main shader filename and capture time for screenshots', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 27, 13, 45, 2, 123));
      getContext.mockReturnValue({ ...defaultContext, path: '/shaders/aurora.glsl' });
      await manager.screenshot({ format: 'png', width: 100, height: 100 });
      const filename = sendFile.mock.calls[0][1];
      expect(filename).toBe('aurora-2026-09-27_13-45-02-123.png');
      vi.useRealTimers();
    });

    it('uses the main shader filename and capture time for recordings', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 27, 13, 45, 2, 123));
      getContext.mockReturnValue({ ...defaultContext, path: String.raw`C:\shaders\ocean.slang` });
      await manager.record({ format: 'webm', duration: 1, startTime: 0, fps: 30, width: 100, height: 100 });
      const filename = sendFile.mock.calls[0][1];
      expect(filename).toBe('ocean-2026-09-27_13-45-02-123.webm');
      vi.useRealTimers();
    });
  });
});
