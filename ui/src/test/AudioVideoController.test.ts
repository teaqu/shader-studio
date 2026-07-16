import { describe, it, expect, vi } from 'vitest';
import { AudioVideoController } from '../lib/AudioVideoController';

describe('AudioVideoController', () => {
  it('should not crash when constructed with engine getter returning undefined', () => {
    expect(() => {
      const controller = new AudioVideoController(() => undefined);
      controller.dispose();
    }).not.toThrow();
  });

  it('should not crash when engine methods are unavailable', () => {
    expect(() => {
      const controller = new AudioVideoController(() => undefined);
      controller.dispose();
    }).not.toThrow();
  });

  it('should call onStateChanged callback with initial store values', () => {
    const onStateChanged = vi.fn();
    const controller = new AudioVideoController(() => undefined, onStateChanged);

    // audioStore fires immediately on subscribe with default values
    expect(onStateChanged).toHaveBeenCalledTimes(1);
    expect(onStateChanged).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Boolean),
    );

    controller.dispose();
  });

  it('should safely handle videoControl when engine is unavailable', () => {
    const controller = new AudioVideoController(() => undefined);

    expect(() => {
      controller.videoControl('/path/to/video.mp4', 'play');
    }).not.toThrow();

    controller.dispose();
  });

  it('should safely handle audioControl when engine is unavailable', () => {
    const controller = new AudioVideoController(() => undefined);

    expect(() => {
      controller.audioControl('/path/to/audio.mp3', 'play');
    }).not.toThrow();

    controller.dispose();
  });

  it('should report audio play and pause intents after dispatching controls', () => {
    const engine = {
      controlAudio: vi.fn(),
      setGlobalVolume: vi.fn(),
    } as any;
    const onPlaybackIntent = vi.fn();
    const controller = new AudioVideoController(() => engine, undefined, onPlaybackIntent);

    controller.audioControl('/path/to/audio.mp3', 'pause');
    controller.audioControl('/path/to/audio.mp3', 'play');

    expect(engine.controlAudio).toHaveBeenCalledWith('/path/to/audio.mp3', 'pause');
    expect(engine.controlAudio).toHaveBeenCalledWith('/path/to/audio.mp3', 'play');
    expect(onPlaybackIntent).toHaveBeenNthCalledWith(1, 'pause');
    expect(onPlaybackIntent).toHaveBeenNthCalledWith(2, 'play');

    controller.dispose();
  });

  it('should report video play and pause intents after dispatching controls', () => {
    const engine = {
      controlVideo: vi.fn(),
      setGlobalVolume: vi.fn(),
    } as any;
    const onPlaybackIntent = vi.fn();
    const controller = new AudioVideoController(() => engine, undefined, onPlaybackIntent);

    controller.videoControl('/path/to/video.mp4', 'pause');
    controller.videoControl('/path/to/video.mp4', 'play');

    expect(engine.controlVideo).toHaveBeenCalledWith('/path/to/video.mp4', 'pause');
    expect(engine.controlVideo).toHaveBeenCalledWith('/path/to/video.mp4', 'play');
    expect(onPlaybackIntent).toHaveBeenNthCalledWith(1, 'pause');
    expect(onPlaybackIntent).toHaveBeenNthCalledWith(2, 'play');

    controller.dispose();
  });

  it('should return null for getVideoState when engine is unavailable', () => {
    const controller = new AudioVideoController(() => undefined);
    expect(controller.getVideoState('/path')).toBeNull();
    controller.dispose();
  });

  it('should return null for getAudioState when engine is unavailable', () => {
    const controller = new AudioVideoController(() => undefined);
    expect(controller.getAudioState('/path')).toBeNull();
    controller.dispose();
  });

  it('should return null for getAudioFFT when engine is unavailable', () => {
    const controller = new AudioVideoController(() => undefined);
    expect(controller.getAudioFFT('frequency')).toBeNull();
    controller.dispose();
  });
});
