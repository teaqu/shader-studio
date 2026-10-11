import { describe, expect, it, vi } from 'vitest';
import { audioPreviewData, livePreviewData, controlAudioInput, controlSystemAudio } from '../../resources/MediaPreview';
import type { LiveInputPreview } from '../../resources/LiveInputTextureManager';

function resources() {
  return {
    getAudioFFTData: vi.fn((): Uint8Array | null => new Uint8Array([7])),
    getLiveInputPreview: vi.fn((): LiveInputPreview | null => ({ ready: true })),
    controlAudioInput: vi.fn(async () => undefined),
    controlSystemAudio: vi.fn(async () => 'sharing denied'),
  };
}

describe('media preview resource routing', () => {
  it('routes only an audio-file request with a path and handles absent resources', () => {
    const host = resources();
    expect(audioPreviewData(host, 'audio', '/song.mp3')).toEqual(new Uint8Array([7]));
    expect(host.getAudioFFTData).toHaveBeenCalledWith('/song.mp3');
    expect(audioPreviewData(host, 'microphone', '/song.mp3')).toBeNull();
    expect(audioPreviewData(host, 'audio')).toBeNull();
    expect(audioPreviewData(null, 'audio', '/song.mp3')).toBeNull();
    host.getAudioFFTData.mockReturnValue(null);
    expect(audioPreviewData(host, 'audio', '/song.mp3')).toBeNull();
    expect(host.getAudioFFTData).toHaveBeenCalledTimes(2);
  });

  it('routes live previews and preserves missing-preview results', () => {
    const host = resources();
    expect(livePreviewData(host, 'screen')).toEqual({ ready: true });
    expect(host.getLiveInputPreview).toHaveBeenCalledWith('screen');
    expect(livePreviewData(null, 'webcam')).toBeNull();
    host.getLiveInputPreview.mockReturnValue(null);
    expect(livePreviewData(host, 'microphone')).toBeNull();
  });

  it('forwards control actions, devices and warnings, including the not-ready fallback', async () => {
    const host = resources();
    await expect(controlAudioInput(host, 'start', 'usb-mic')).resolves.toBeUndefined();
    expect(host.controlAudioInput).toHaveBeenCalledWith('start', 'usb-mic');
    await expect(controlSystemAudio(host, 'stop')).resolves.toBe('sharing denied');
    expect(host.controlSystemAudio).toHaveBeenCalledWith('stop', undefined);
    await expect(controlAudioInput(null, 'stop')).resolves.toContain('not ready');
    await expect(controlSystemAudio(null, 'start')).resolves.toContain('not ready');
  });
});
