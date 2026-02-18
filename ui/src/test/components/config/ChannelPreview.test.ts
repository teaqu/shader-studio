import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChannelPreview from '../../../lib/components/config/ChannelPreview.svelte';
import type { ConfigInput } from '@shader-studio/types';

describe('ChannelPreview', () => {
  let mockGetWebviewUri: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetWebviewUri = vi.fn((path: string) => `webview://resolved/${path}`);
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
    it('should show fallback when image has not loaded yet', () => {
      const input: ConfigInput = {
        type: 'texture',
        path: 'test.png',
        resolved_path: 'https://webview-uri/test.png'
      } as any;

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      // Image element exists but hasn't loaded yet - fallback should be visible
      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.classList.contains('loaded')).toBe(false);
      expect(container.querySelector('.preview-fallback')).toBeTruthy();
    });

    it('should hide fallback after image loads successfully', async () => {
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

      expect(img.classList.contains('loaded')).toBe(true);
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

      expect(img.classList.contains('loaded')).toBe(false);
      expect(container.querySelector('.preview-fallback')).toBeTruthy();
    });

    it('should show fallback when path has no resolved URI', () => {
      // getWebviewUri returns undefined for unknown paths
      mockGetWebviewUri = vi.fn(() => undefined);

      const input: ConfigInput = {
        type: 'texture',
        path: 'unknown.png'
      };

      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      // Image element still renders (with raw path), fallback shows until load
      const img = container.querySelector('.preview-image') as HTMLImageElement;
      expect(img).toBeTruthy();
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

  describe('Other Input Types', () => {
    it('should render buffer preview', () => {
      const input: ConfigInput = { type: 'buffer', source: 'BufferA' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      expect(container.querySelector('.buffer-preview')).toBeTruthy();
      expect(container.querySelector('.buffer-name')).toBeTruthy();
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
    it('should not show overlay label for texture when image has not loaded', () => {
      const input: ConfigInput = { type: 'texture', path: 'test.png' };
      const { container } = render(ChannelPreview, {
        channelInput: input,
        getWebviewUri: mockGetWebviewUri
      });

      // Before image loads, fallback shows instead of overlay
      expect(container.querySelector('.preview-overlay')).toBeFalsy();
      expect(container.querySelector('.preview-fallback')).toBeTruthy();
    });

    it('should show overlay label for texture when image has loaded', async () => {
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
});
