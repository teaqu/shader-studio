import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import VideoTab from '../../../../lib/components/config/tabs/VideoTab.svelte';
import type { ConfigInput } from '@shader-studio/types';

describe('VideoTab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = () => ({
    tempInput: { type: 'video', path: '' } as ConfigInput | undefined,
    channelName: 'iChannel0',
    shaderPath: '/test/shader.glsl',
    postMessage: vi.fn(),
    onMessage: undefined as ((handler: (event: MessageEvent) => void) => void) | undefined,
    onAssetSelect: vi.fn(),
    onUpdatePath: vi.fn(),
    onUpdateFilter: vi.fn(),
    onUpdateWrap: vi.fn(),
    onUpdateVFlip: vi.fn(),
    audioVideoController: undefined as any,
  });

  describe('Rendering', () => {
    it('should render path input with video placeholder', () => {
      render(VideoTab, defaultProps());

      expect(screen.getByPlaceholderText('Path to video file or URL')).toBeInTheDocument();
    });

    it('should render filter and wrap selects', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
      };

      render(VideoTab, props);

      expect(screen.getByLabelText('Filter:')).toBeInTheDocument();
      expect(screen.getByLabelText('Wrap:')).toBeInTheDocument();
    });

    it('should render vflip checkbox', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
      };

      render(VideoTab, props);

      expect(screen.getByLabelText('Vertical Flip')).toBeInTheDocument();
    });

    it('should display existing path value', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './existing.mp4' } as ConfigInput,
      };

      render(VideoTab, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('./existing.mp4');
    });
  });

  describe('Default values', () => {
    it('should default filter to linear', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
      };

      render(VideoTab, props);

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      expect(filterSelect.value).toBe('linear');
    });

    it('should default wrap to clamp', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
      };

      render(VideoTab, props);

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      expect(wrapSelect.value).toBe('clamp');
    });

    it('should default vflip to true', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
      };

      render(VideoTab, props);

      const vflipCheckbox = screen.getByLabelText('Vertical Flip') as HTMLInputElement;
      expect(vflipCheckbox.checked).toBe(true);
    });
  });

  describe('Callbacks', () => {
    it('should call onUpdatePath when path changes', async () => {
      const props = defaultProps();
      render(VideoTab, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './new-video.mp4' } });

      expect(props.onUpdatePath).toHaveBeenCalledWith('./new-video.mp4');
    });

    it('should call onUpdateFilter when filter changes', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
      };

      render(VideoTab, props);

      const filterSelect = screen.getByLabelText('Filter:') as HTMLSelectElement;
      await fireEvent.change(filterSelect, { target: { value: 'nearest' } });

      expect(props.onUpdateFilter).toHaveBeenCalledWith('nearest');
    });

    it('should call onUpdateWrap when wrap changes', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
      };

      render(VideoTab, props);

      const wrapSelect = screen.getByLabelText('Wrap:') as HTMLSelectElement;
      await fireEvent.change(wrapSelect, { target: { value: 'repeat' } });

      expect(props.onUpdateWrap).toHaveBeenCalledWith('repeat');
    });

    it('should call onUpdateVFlip when vflip toggled', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4', vflip: true } as ConfigInput,
      };

      render(VideoTab, props);

      const vflipCheckbox = screen.getByLabelText('Vertical Flip') as HTMLInputElement;
      await fireEvent.click(vflipCheckbox);

      expect(props.onUpdateVFlip).toHaveBeenCalledWith(false);
    });
  });

  describe('Video Controls', () => {
    it('should render control buttons when audioVideoController is provided', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
        audioVideoController: { videoControl: vi.fn(), getVideoState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 60 }), audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(VideoTab, props);

      expect(container.querySelector('.btn-control[title="Pause"]')).toBeTruthy();
      expect(container.querySelector('.btn-control[title="Mute"]')).toBeTruthy();
      expect(container.querySelector('.btn-control[title="Reset to beginning"]')).toBeTruthy();
    });

    it('should not render controls when audioVideoController is not provided', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
      };

      const { container } = render(VideoTab, props);

      expect(container.querySelector('.video-controls')).toBeFalsy();
    });

    it('should show play button when video is paused', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
        audioVideoController: { videoControl: vi.fn(), getVideoState: vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 }), audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(VideoTab, props);

      expect(container.querySelector('.btn-control[title="Play"]')).toBeTruthy();
    });

    it('should show unmute button when video is muted', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
        audioVideoController: { videoControl: vi.fn(), getVideoState: vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 5, duration: 30 }), audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(VideoTab, props);

      const unmuteBtn = container.querySelector('.btn-control[title="Unmute"]');
      expect(unmuteBtn).toBeTruthy();
      // Should use SVG icon
      expect(unmuteBtn!.querySelector('svg')).toBeTruthy();
    });

    it('should call videoControl when play/pause clicked', async () => {
      const mockVideoControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
        audioVideoController: { videoControl: mockVideoControl, getVideoState: vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 }), audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(VideoTab, props);

      const playBtn = container.querySelector('.btn-control[title="Play"]');
      await fireEvent.click(playBtn!);

      expect(mockVideoControl).toHaveBeenCalled();
      const call = mockVideoControl.mock.calls[mockVideoControl.mock.calls.length - 1];
      expect(call[1]).toBe('play');
    });

    it('should call videoControl when reset clicked', async () => {
      const mockVideoControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
        audioVideoController: { videoControl: mockVideoControl, getVideoState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 30, duration: 60 }), audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(VideoTab, props);

      const resetBtn = container.querySelector('.btn-control[title="Reset to beginning"]');
      await fireEvent.click(resetBtn!);

      expect(mockVideoControl).toHaveBeenCalled();
      const call = mockVideoControl.mock.calls[mockVideoControl.mock.calls.length - 1];
      expect(call[1]).toBe('reset');
    });

    it('should display video timer', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
        audioVideoController: { videoControl: vi.fn(), getVideoState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 65, duration: 180 }), audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(VideoTab, props);

      const timer = container.querySelector('.video-timer');
      expect(timer).toBeTruthy();
      expect(timer!.textContent).toContain('1:05');
      expect(timer!.textContent).toContain('3:00');
    });

    it('should render reset button with circular arrow character', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'video', path: './test.mp4' } as ConfigInput,
        audioVideoController: { videoControl: vi.fn(), getVideoState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 60 }), audioControl: vi.fn(), getAudioState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(VideoTab, props);

      const resetBtn = container.querySelector('.btn-control[title="Reset to beginning"]');
      expect(resetBtn!.textContent).toContain('\u21BA');
      expect(resetBtn!.textContent).not.toContain('\u23EE');
    });
  });
});
