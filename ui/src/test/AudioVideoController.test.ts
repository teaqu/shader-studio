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
