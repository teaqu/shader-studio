import { describe, it, expect, vi } from 'vitest';
import { AudioVideoController } from '../lib/AudioVideoController';
import { audioStore } from '../lib/stores/audioStore';

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

  it('should dispatch audio play and pause actions to the engine', () => {
    const engine = {
      controlAudio: vi.fn(),
      setGlobalVolume: vi.fn(),
    } as any;
    const controller = new AudioVideoController(() => engine);

    controller.audioControl('/path/to/audio.mp3', 'pause');
    controller.audioControl('/path/to/audio.mp3', 'play');

    expect(engine.controlAudio).toHaveBeenCalledWith('/path/to/audio.mp3', 'pause');
    expect(engine.controlAudio).toHaveBeenCalledWith('/path/to/audio.mp3', 'play');

    controller.dispose();
  });

  it('should dispatch video play and pause actions to the engine', () => {
    const engine = {
      controlVideo: vi.fn(),
      setGlobalVolume: vi.fn(),
    } as any;
    const controller = new AudioVideoController(() => engine);

    controller.videoControl('/path/to/video.mp4', 'pause');
    controller.videoControl('/path/to/video.mp4', 'play');

    expect(engine.controlVideo).toHaveBeenCalledWith('/path/to/video.mp4', 'pause');
    expect(engine.controlVideo).toHaveBeenCalledWith('/path/to/video.mp4', 'play');

    controller.dispose();
  });

  it('forwards unmute to the engine even while globally muted', () => {
    const engine = {
      controlVideo: vi.fn(),
      setGlobalVolume: vi.fn(),
    } as any;
    const controller = new AudioVideoController(() => engine);
    audioStore.setMuted(true);

    controller.videoControl('v.mp4', 'unmute');

    expect(engine.controlVideo).toHaveBeenCalledWith('v.mp4', 'unmute');

    controller.dispose();
  });

  it('forwards audio unmute to the engine even while globally muted', () => {
    const engine = {
      controlAudio: vi.fn(),
      setGlobalVolume: vi.fn(),
    } as any;
    const controller = new AudioVideoController(() => engine);
    audioStore.setMuted(true);

    controller.audioControl('a.mp3', 'unmute');

    expect(engine.controlAudio).toHaveBeenCalledWith('a.mp3', 'unmute');

    controller.dispose();
  });

  it('does not re-apply global volume after unmute', () => {
    const engine = {
      controlAudio: vi.fn(),
      setGlobalVolume: vi.fn(),
    } as any;
    const controller = new AudioVideoController(() => engine);
    engine.setGlobalVolume.mockClear(); // clear the construction-time subscription call

    controller.audioControl('a.mp3', 'unmute');

    expect(engine.setGlobalVolume).not.toHaveBeenCalledWith(expect.anything(), false);

    controller.dispose();
  });

  it('does not re-apply global volume after video unmute', () => {
    const engine = {
      controlVideo: vi.fn(),
      setGlobalVolume: vi.fn(),
    } as any;
    const controller = new AudioVideoController(() => engine);
    engine.setGlobalVolume.mockClear(); // clear the construction-time subscription call

    controller.videoControl('v.mp4', 'unmute');

    expect(engine.setGlobalVolume).not.toHaveBeenCalledWith(expect.anything(), false);

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
