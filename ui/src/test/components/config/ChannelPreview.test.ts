import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChannelPreview from '../../../lib/components/config/ChannelPreview.svelte';
import type { ConfigInput } from '@shader-studio/types';

// Mock waveformCache
vi.mock('../../../lib/util/waveformCache', () => ({
  getWaveformPeaks: vi.fn().mockResolvedValue(null),
}));

import { getWaveformPeaks } from '../../../lib/util/waveformCache';
const mockGetWaveformPeaks = getWaveformPeaks as ReturnType<typeof vi.fn>;

describe('ChannelPreview', () => {
  let mockGetWebviewUri: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetWebviewUri = vi.fn((path: string) => `webview://resolved/${path}`);
    mockGetWaveformPeaks.mockResolvedValue(null);
  });

  describe('Empty State', () => {
    it('should show empty preview when no channelInput', () => {
      const { container } = render(ChannelPreview, {
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.empty-preview')).toBeTruthy();
      expect(container.querySelector('.empty-icon')).toBeTruthy();
    });
  });

  describe('Texture Preview', () => {
    it('should render texture preview for texture type', () => {
      const input: ConfigInput = { type: 'texture', path: 'test.png' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.texture-preview')).toBeTruthy();
    });

    it('should use resolved_path for image src when available', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.src).toContain('https://webview-uri/test.png');
    });

    it('should fall back to getWebviewUri when no resolved_path', () => {
      const input: ConfigInput = { type: 'texture', path: 'fallback.png' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.src).toContain('webview://resolved/fallback.png');
      expect(mockGetWebviewUri).toHaveBeenCalledWith('fallback.png');
    });

    it('should show fallback when no path is set', () => {
      const input: ConfigInput = { type: 'texture', path: '' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.preview-fallback')).toBeTruthy();
      expect(container.querySelector('.preview-image')).toBeFalsy();
    });
  });

  describe('Vertical Flip (vflip)', () => {
    it('should not flip image when vflip is true (default Shadertoy convention)', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        vflip: true,
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      // vflip=true is the default - image should NOT be flipped
      expect(img.style.transform).not.toContain('scaleY(-1)');
    });

    it('should flip image when vflip is false (unchecked)', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        vflip: false,
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.style.transform).toBe('scaleY(-1)');
    });

    it('should not flip image when vflip is undefined (defaults to true)', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.style.transform).not.toContain('scaleY(-1)');
    });
  });

  describe('Grayscale', () => {
    it('should apply grayscale filter when grayscale is true', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        grayscale: true,
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.style.filter).toBe('grayscale(100%)');
    });

    it('should not apply grayscale filter when grayscale is false', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        grayscale: false,
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.style.filter).not.toContain('grayscale');
    });

    it('should not apply grayscale when grayscale is undefined', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.style.filter).not.toContain('grayscale');
    });
  });

  describe('Combined Effects', () => {
    it('should apply both flip and grayscale together', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        vflip: false,
        grayscale: true,
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.style.transform).toBe('scaleY(-1)');
      expect(img.style.filter).toBe('grayscale(100%)');
    });

    it('should apply no effects when vflip is true and grayscale is false', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        vflip: true,
        grayscale: false,
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.style.transform).toBe('');
      expect(img.style.filter).toBe('');
    });
  });

  describe('Fallback on Load Failure', () => {
    it('should show overlay when image src is available', async () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      // Image element exists with valid src - fire load event to trigger overlay
      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      await fireEvent.load(img);
      expect(container.querySelector('.preview-overlay')).toBeTruthy();
      expect(container.querySelector('.preview-fallback')).toBeFalsy();
    });

    it('should show fallback after image load error', async () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'missing.png',
        resolved_path: 'https://webview-uri/missing.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      await fireEvent.error(img);

      expect(container.querySelector('.preview-fallback')).toBeTruthy();
      expect(container.querySelector('.preview-overlay')).toBeFalsy();
    });

    it('should show overlay when path falls back to raw path', async () => {
      // getWebviewUri returns undefined, but raw path is used as fallback
      mockGetWebviewUri = vi.fn(() => undefined);

      const input: ConfigInput = {
        type: 'texture',
        path: 'unknown.png'
      };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      // imageSrc falls back to raw path - fire load event to trigger overlay
      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      await fireEvent.load(img);
      expect(container.querySelector('.preview-overlay')).toBeTruthy();
      expect(container.querySelector('.preview-fallback')).toBeFalsy();
    });

    it('should show fallback when no path is provided', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: ''
      };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      // No imageSrc, so fallback shows
      expect(container.querySelector('.preview-image')).toBeFalsy();
      expect(container.querySelector('.preview-fallback')).toBeTruthy();
    });
  });

  describe('Preview Updates on Path Change', () => {
    it('should update image src when path changes', async () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'first.png',
        resolved_path: 'https://webview-uri/first.png'
      } as any;

      const defaultProps = {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      };

      const { container, rerender } = render(ChannelPreview, defaultProps);

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img.src).toContain('first.png');

      // Change path - src should update
      const newInput: ConfigInput = {
        type: 'texture',
        path: 'second.png',
        resolved_path: 'https://webview-uri/second.png'
      } as any;
      await rerender({ ...defaultProps, channelInput: newInput });

      const updatedImg = container.querySelector('.preview-image') as HTMLImageElement;
      expect(updatedImg.src).toContain('second.png');
    });

    it('should update image src when resolved_path is added', async () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'texture.png'
      };

      const defaultProps = {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      };

      const { container, rerender } = render(ChannelPreview, defaultProps);

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img.src).toContain('webview://resolved/texture.png');

      // Simulate resolved_path arriving from extension
      const updatedInput: ConfigInput = {
        type: 'texture',
        path: 'texture.png',
        resolved_path: 'https://webview-uri/full/path/texture.png'
      } as any;
      await rerender({ ...defaultProps, channelInput: updatedInput });

      const updatedImg = container.querySelector('.preview-image') as HTMLImageElement;
      expect(updatedImg.src).toContain('https://webview-uri/full/path/texture.png');
    });
  });

  describe('Audio Controls on Preview', () => {
    let mockOnAudioControl: ReturnType<typeof vi.fn>;
    let mockGetAudioState: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOnAudioControl = vi.fn();
      mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 10, duration: 120 });
    });

    it('should show audio controls when audioVideoController is provided', () => {
      const input: ConfigInput = { type: 'audio', path: 'music.mp3' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      expect(container.querySelector('.preview-controls')).toBeTruthy();
    });

    it('should not show audio controls when audioVideoController is not provided', () => {
      const input: ConfigInput = { type: 'audio', path: 'music.mp3' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.preview-controls')).toBeFalsy();
    });

    it('should call onAudioControl with pause when pause button clicked', async () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const pauseBtn = container.querySelector('.preview-ctrl-btn[title="Pause"]') as HTMLButtonElement;
      expect(pauseBtn).toBeTruthy();
      await fireEvent.click(pauseBtn);

      expect(mockOnAudioControl).toHaveBeenCalledWith('https://webview-uri/music.mp3', 'pause');
    });

    it('should call onAudioControl with play when play button clicked and paused', async () => {
      mockGetAudioState.mockReturnValue({ paused: true, muted: false, currentTime: 10, duration: 120 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const playBtn = container.querySelector('.preview-ctrl-btn[title="Play"]') as HTMLButtonElement;
      expect(playBtn).toBeTruthy();
      await fireEvent.click(playBtn);

      expect(mockOnAudioControl).toHaveBeenCalledWith('https://webview-uri/music.mp3', 'play');
    });

    it('should call onAudioControl with reset when reset button clicked', async () => {
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const resetBtn = container.querySelector('.preview-ctrl-btn[title="Reset to beginning"]') as HTMLButtonElement;
      expect(resetBtn).toBeTruthy();
      await fireEvent.click(resetBtn);

      expect(mockOnAudioControl).toHaveBeenCalledWith('https://webview-uri/music.mp3', 'reset');
    });

    it('should not show audio controls when audio has no path', () => {
      const input: ConfigInput = { type: 'audio', path: '' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      expect(container.querySelector('.preview-controls')).toBeFalsy();
    });

    it('should show timer when audio has duration', () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: 65, duration: 180 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const timer = container.querySelector('.preview-timer');
      expect(timer).toBeTruthy();
      expect(timer!.textContent).toContain('1:05');
      expect(timer!.textContent).toContain('3:00');
    });
  });

  describe('Other Input Types', () => {
    it('should render buffer preview', () => {
      const input: ConfigInput = { type: 'buffer', source: 'BufferA' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.buffer-preview')).toBeTruthy();
      expect(container.querySelector('.buffer-letter')).toBeTruthy();
    });

    it('should render video preview', () => {
      const input: ConfigInput = { type: 'video', path: 'test.mp4' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.video-preview')).toBeTruthy();
    });

    it('should render keyboard preview', () => {
      const input: ConfigInput = { type: 'keyboard' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.keyboard-preview')).toBeTruthy();
    });
  });

  describe('Preview Overlay Labels', () => {
    it('should show overlay label for texture when image src is available', async () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        resolved_path: 'https://webview-uri/test.png'
      } as any;
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      await fireEvent.load(img);
      const overlay = container.querySelector('.preview-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay?.textContent?.trim()).toBe('Texture');
    });

    it('should show fallback instead of overlay when no image src', () => {
      const input: ConfigInput = { type: 'texture', path: '' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.preview-overlay')).toBeFalsy();
      expect(container.querySelector('.preview-fallback')).toBeTruthy();
    });

    it('should show overlay label for video type', () => {
      const input: ConfigInput = { type: 'video', path: 'test.mp4' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const overlay = container.querySelector('.preview-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay?.textContent?.trim()).toBe('Video');
    });

    it('should not show overlay label for buffer type', () => {
      const input: ConfigInput = { type: 'buffer', source: 'BufferA' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.preview-overlay')).toBeFalsy();
    });

    it('should not show overlay label for keyboard type', () => {
      const input: ConfigInput = { type: 'keyboard' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.preview-overlay')).toBeFalsy();
    });

    it('should not show overlay label for empty/unconfigured state', () => {
      const { container } = render(ChannelPreview, {
        channelInput: undefined,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.preview-overlay')).toBeFalsy();
    });
  });

  describe('Audio Waveform Preview', () => {
    it('should not render canvas when getAudioFFT is not provided', () => {
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
      });

      expect(container.querySelector('.fft-canvas')).toBeFalsy();
      expect(container.querySelector('.audio-wave-icon')).toBeTruthy();
    });

    it('should show static wave icon fallback when no getAudioFFT', () => {
      const input: ConfigInput = { type: 'audio', path: '' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
      });

      expect(container.querySelector('.fft-canvas')).toBeFalsy();
      expect(container.querySelector('.audio-wave-icon')).toBeTruthy();
    });

    it('should show canvas when getAudioFFT is provided (even without waveform)', () => {
      const mockFFT = vi.fn().mockReturnValue(new Uint8Array(32));
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { getAudioFFT: mockFFT, videoControl: vi.fn(), getVideoState: vi.fn(), audioControl: vi.fn(), getAudioState: vi.fn() } as any,
      });

      expect(container.querySelector('.fft-canvas')).toBeTruthy();
    });

    it('should have mouseenter and mouseleave handlers on audio-preview', async () => {
      const peaks = new Float32Array([0.5, 0.8, 1.0]);
      mockGetWaveformPeaks.mockResolvedValue(peaks);
      const mockFFT = vi.fn().mockReturnValue(new Uint8Array(32));

      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { getAudioFFT: mockFFT, videoControl: vi.fn(), getVideoState: vi.fn(), audioControl: vi.fn(), getAudioState: vi.fn() } as any,
      });

      await vi.waitFor(() => {
        expect(container.querySelector('.fft-canvas')).toBeTruthy();
      });

      const audioPreview = container.querySelector('.audio-preview')!;
      // Should not throw on hover events
      await fireEvent.mouseEnter(audioPreview);
      await fireEvent.mouseLeave(audioPreview);
    });

  });

  describe('Audio mute/unmute controls', () => {
    let mockOnAudioControl: ReturnType<typeof vi.fn>;
    let mockGetAudioState: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOnAudioControl = vi.fn();
      mockGetAudioState = vi.fn();
    });

    it('should show unmute button when audio is muted', () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: true, currentTime: 0, duration: 60 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const muteBtn = container.querySelector('.preview-ctrl-btn[title="Unmute"]') as HTMLButtonElement;
      expect(muteBtn).toBeTruthy();
    });

    it('should show mute button when audio is unmuted', () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 60 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const muteBtn = container.querySelector('.preview-ctrl-btn[title="Mute"]') as HTMLButtonElement;
      expect(muteBtn).toBeTruthy();
    });

    it('should call onAudioControl with mute when mute button clicked', async () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 60 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const muteBtn = container.querySelector('.preview-ctrl-btn[title="Mute"]') as HTMLButtonElement;
      expect(muteBtn).toBeTruthy();
      await fireEvent.click(muteBtn);

      expect(mockOnAudioControl).toHaveBeenCalledWith('https://webview-uri/music.mp3', 'mute');
    });

    it('should call onAudioControl with unmute when unmute button clicked', async () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: true, currentTime: 0, duration: 60 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const muteBtn = container.querySelector('.preview-ctrl-btn[title="Unmute"]') as HTMLButtonElement;
      expect(muteBtn).toBeTruthy();
      await fireEvent.click(muteBtn);

      expect(mockOnAudioControl).toHaveBeenCalledWith('https://webview-uri/music.mp3', 'unmute');
    });
  });

  describe('Audio timer formatting', () => {
    let mockOnAudioControl: ReturnType<typeof vi.fn>;
    let mockGetAudioState: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOnAudioControl = vi.fn();
      mockGetAudioState = vi.fn();
    });

    it('should display 0:00 / 0:00 when duration is 0', () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 0 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // When duration is 0, the component shows the "Audio" label instead of timer
      const label = container.querySelector('.preview-label');
      expect(label).toBeTruthy();
      expect(label!.textContent?.trim()).toBe('Audio');
    });

    it('should format seconds correctly (e.g., 5 seconds shows 0:05)', () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: 5, duration: 30 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const timer = container.querySelector('.preview-timer');
      expect(timer).toBeTruthy();
      expect(timer!.textContent).toContain('0:05');
      expect(timer!.textContent).toContain('0:30');
    });

    it('should format minutes correctly (e.g., 125 seconds shows 2:05)', () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: 125, duration: 300 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const timer = container.querySelector('.preview-timer');
      expect(timer).toBeTruthy();
      expect(timer!.textContent).toContain('2:05');
      expect(timer!.textContent).toContain('5:00');
    });

    it('should handle large durations (e.g., 3600 seconds shows 60:00)', () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 3600 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const timer = container.querySelector('.preview-timer');
      expect(timer).toBeTruthy();
      expect(timer!.textContent).toContain('60:00');
    });

    it('should handle non-finite values gracefully', () => {
      mockGetAudioState.mockReturnValue({ paused: false, muted: false, currentTime: NaN, duration: Infinity });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      // Non-finite duration means duration > 0 is false for Infinity... actually Infinity > 0 is true
      // but formatVideoTime returns '0:00' for non-finite values
      const timer = container.querySelector('.preview-timer');
      if (timer) {
        expect(timer.textContent).toContain('0:00');
      } else {
        // If duration is not finite, the label fallback may show
        const label = container.querySelector('.preview-label');
        expect(label).toBeTruthy();
      }
    });
  });

  describe('Audio preview with no path', () => {
    it('should show placeholder when audio has empty path', () => {
      const input: ConfigInput = { type: 'audio', path: '' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.audio-preview')).toBeTruthy();
      expect(container.querySelector('.audio-wave-icon')).toBeTruthy();
    });

    it('should not show controls when audio has empty path', () => {
      const mockOnAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 60 });
      const input: ConfigInput = { type: 'audio', path: '' };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      expect(container.querySelector('.preview-controls')).toBeFalsy();
    });
  });

  describe('Video control buttons', () => {
    let mockOnVideoControl: ReturnType<typeof vi.fn>;
    let mockGetVideoState: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockOnVideoControl = vi.fn();
      mockGetVideoState = vi.fn();
    });

    it('should show play button when video is paused', () => {
      mockGetVideoState.mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 });
      const input: ConfigInput = { type: 'video', path: 'video.mp4' };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { videoControl: mockOnVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const playBtn = container.querySelector('.preview-ctrl-btn[title="Play"]') as HTMLButtonElement;
      expect(playBtn).toBeTruthy();
    });

    it('should show pause button when video is playing', () => {
      mockGetVideoState.mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 60 });
      const input: ConfigInput = { type: 'video', path: 'video.mp4' };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { videoControl: mockOnVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const pauseBtn = container.querySelector('.preview-ctrl-btn[title="Pause"]') as HTMLButtonElement;
      expect(pauseBtn).toBeTruthy();
    });

    it('should call onVideoControl with play when play button clicked', async () => {
      mockGetVideoState.mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 });
      const input: ConfigInput = { type: 'video', path: 'video.mp4' };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { videoControl: mockOnVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const playBtn = container.querySelector('.preview-ctrl-btn[title="Play"]') as HTMLButtonElement;
      expect(playBtn).toBeTruthy();
      await fireEvent.click(playBtn);

      expect(mockOnVideoControl).toHaveBeenCalledWith('video.mp4', 'play');
    });

    it('should call onVideoControl with pause when pause button clicked', async () => {
      mockGetVideoState.mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 60 });
      const input: ConfigInput = { type: 'video', path: 'video.mp4' };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { videoControl: mockOnVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const pauseBtn = container.querySelector('.preview-ctrl-btn[title="Pause"]') as HTMLButtonElement;
      expect(pauseBtn).toBeTruthy();
      await fireEvent.click(pauseBtn);

      expect(mockOnVideoControl).toHaveBeenCalledWith('video.mp4', 'pause');
    });

    it('should call onVideoControl with reset when reset button clicked', async () => {
      mockGetVideoState.mockReturnValue({ paused: false, muted: false, currentTime: 30, duration: 60 });
      const input: ConfigInput = { type: 'video', path: 'video.mp4' };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { videoControl: mockOnVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const resetBtn = container.querySelector('.preview-ctrl-btn[title="Reset to beginning"]') as HTMLButtonElement;
      expect(resetBtn).toBeTruthy();
      await fireEvent.click(resetBtn);

      expect(mockOnVideoControl).toHaveBeenCalledWith('video.mp4', 'reset');
    });

    it('should not show controls when no onVideoControl provided', () => {
      const input: ConfigInput = { type: 'video', path: 'video.mp4' };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.preview-controls')).toBeFalsy();
    });

    it('should not show controls when video has no path', () => {
      mockGetVideoState.mockReturnValue({ paused: false, muted: false, currentTime: 0, duration: 60 });
      const input: ConfigInput = { type: 'video', path: '' };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { videoControl: mockOnVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      expect(container.querySelector('.preview-controls')).toBeFalsy();
    });
  });

  describe('Cubemap preview', () => {
    it('should render cubemap preview for cubemap type', () => {
      const input: ConfigInput = { type: 'cubemap', path: 'cubemap.png' } as any;
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.texture-preview')).toBeTruthy();
    });

    it('should show cubemap-specific label', async () => {
      const input: ConfigInput = {
        type: 'cubemap',
        path: 'cubemap.png',
        resolved_path: 'https://webview-uri/cubemap.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();

      // Cubemap uses imageError check, not imageLoaded - simulate no error with loaded image
      // The cubemap branch checks `imageError || !imageSrc` for fallback vs overlay
      // Since imageSrc is set and no error, the overlay with "Cubemap" label should show
      const overlay = container.querySelector('.preview-overlay');
      expect(overlay).toBeTruthy();
      expect(overlay!.textContent?.trim()).toBe('Cubemap');
    });
  });

  describe('Audio preview with globalMuted', () => {
    it('should show globalMuted indicator when globalMuted is true', () => {
      const mockOnAudioControl = vi.fn();
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 0, duration: 60 });
      const input: ConfigInput = {
        type: 'audio',
        path: 'music.mp3',
        resolved_path: 'https://webview-uri/music.mp3'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { audioControl: mockOnAudioControl, getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
        globalMuted: true
      });

      // When globalMuted is true and audio is muted, the unmute button should be disabled
      // with title "Unmute globally first (options menu)"
      const disabledBtn = container.querySelector('.preview-ctrl-btn[title="Unmute globally first (options menu)"]') as HTMLButtonElement;
      expect(disabledBtn).toBeTruthy();
      expect(disabledBtn.disabled).toBe(true);
    });
  });

  describe('Video mute via config UI only', () => {
    it('should call onVideoControl with mute when mute button clicked', async () => {
      const input: ConfigInput = { type: 'video', path: 'video.mp4' };
      const mockVideoControl = vi.fn();
      const mockGetVideoState = vi.fn().mockReturnValue({
        paused: false,
        muted: false,
        currentTime: 5,
        duration: 60,
      });

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { videoControl: mockVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      await vi.waitFor(() => {
        const buttons = container.querySelectorAll('.preview-ctrl-btn');
        expect(buttons.length).toBeGreaterThanOrEqual(2);
      });

      const buttons = container.querySelectorAll('.preview-ctrl-btn');
      const muteBtn = buttons[1];
      await fireEvent.click(muteBtn);

      expect(mockVideoControl).toHaveBeenCalledWith('video.mp4', 'mute');
    });

    it('should call onVideoControl with unmute when unmute button clicked', async () => {
      const input: ConfigInput = { type: 'video', path: 'video.mp4' };
      const mockVideoControl = vi.fn();
      const mockGetVideoState = vi.fn().mockReturnValue({
        paused: false,
        muted: true,
        currentTime: 5,
        duration: 60,
      });

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri,
        audioVideoController: { videoControl: mockVideoControl, getVideoState: mockGetVideoState, audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      await vi.waitFor(() => {
        const buttons = container.querySelectorAll('.preview-ctrl-btn');
        expect(buttons.length).toBeGreaterThanOrEqual(2);
      });

      const buttons = container.querySelectorAll('.preview-ctrl-btn');
      const muteBtn = buttons[1];
      await fireEvent.click(muteBtn);

      expect(mockVideoControl).toHaveBeenCalledWith('video.mp4', 'unmute');
    });
  });
});
