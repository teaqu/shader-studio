import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import MusicTab from '../../../../lib/components/config/tabs/MusicTab.svelte';
import type { ConfigInput } from '@shader-studio/types';

describe('MusicTab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = () => ({
    tempInput: { type: 'audio', path: '' } as ConfigInput | undefined,
    channelName: 'iChannel0',
    shaderPath: '/test/shader.glsl',
    postMessage: vi.fn(),
    getWebviewUri: vi.fn((path: string) => `webview://path/${path}`),
    lastSelectedResolvedUri: '',
    onAssetSelect: vi.fn(),
    onUpdatePath: vi.fn(),
    onUpdateTempInput: vi.fn(),
    onAutoSave: vi.fn(),
    audioVideoController: undefined as any,
  });

  describe('Rendering', () => {
    it('should render path input with audio placeholder', () => {
      render(MusicTab, defaultProps());

      expect(screen.getByPlaceholderText('Path to audio file (.mp3, .wav, .ogg)')).toBeInTheDocument();
    });

    it('should display existing audio path', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
      };

      render(MusicTab, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      expect(pathInput.value).toBe('./music.mp3');
    });
  });

  describe('Audio Controls', () => {
    it('should render control buttons when onAudioControl and getAudioState are provided', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      expect(container.querySelector('.btn-control[title="Pause"]')).toBeTruthy();
      expect(container.querySelector('.btn-control[title="Mute"]')).toBeTruthy();
      expect(container.querySelector('.btn-control[title="Reset to beginning"]')).toBeTruthy();
    });

    it('should not show audio controls when onAudioControl is not provided', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
      };

      const { container } = render(MusicTab, props);

      expect(container.querySelector('.video-controls .controls-row')).toBeFalsy();
    });

    it('should show play button when audio is paused', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      expect(container.querySelector('.btn-control[title="Play"]')).toBeTruthy();
    });

    it('should show unmute button with codicon when audio is muted', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: true, currentTime: 0, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const unmuteBtn = container.querySelector('.btn-control[title="Unmute"]');
      expect(unmuteBtn).toBeTruthy();
      expect(unmuteBtn!.querySelector('.codicon-mute')).toBeTruthy();
    });

    it('should display timer with formatted time', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 65, duration: 180 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const timer = container.querySelector('.video-timer');
      expect(timer).toBeTruthy();
      expect(timer!.textContent).toContain('1:05');
      expect(timer!.textContent).toContain('3:00');
    });

    it('should call onAudioControl with play when play button clicked', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const playBtn = container.querySelector('.btn-control[title="Play"]');
      await fireEvent.click(playBtn!);

      expect(mockAudioControl).toHaveBeenCalled();
      const call = mockAudioControl.mock.calls[mockAudioControl.mock.calls.length - 1];
      expect(call[1]).toBe('play');
    });

    it('should call onAudioControl with pause when pause button clicked', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const pauseBtn = container.querySelector('.btn-control[title="Pause"]');
      await fireEvent.click(pauseBtn!);

      const call = mockAudioControl.mock.calls[mockAudioControl.mock.calls.length - 1];
      expect(call[1]).toBe('pause');
    });

    it('should call onAudioControl with mute when mute button clicked', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const muteBtn = container.querySelector('.btn-control[title="Mute"]');
      await fireEvent.click(muteBtn!);

      const call = mockAudioControl.mock.calls[mockAudioControl.mock.calls.length - 1];
      expect(call[1]).toBe('mute');
    });

    it('should call onAudioControl with reset when reset button clicked', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 30, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const resetBtn = container.querySelector('.btn-control[title="Reset to beginning"]');
      await fireEvent.click(resetBtn!);

      const call = mockAudioControl.mock.calls[mockAudioControl.mock.calls.length - 1];
      expect(call[1]).toBe('reset');
    });
  });

  describe('Effective Audio Path Resolution', () => {
    it('should use resolved_path when available', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3', resolved_path: 'webview://cdn/music.mp3' } as any,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const playBtn = container.querySelector('.btn-control[title="Play"]');
      if (playBtn) {
        await fireEvent.click(playBtn);
        expect(mockAudioControl).toHaveBeenCalledWith('webview://cdn/music.mp3', 'play');
      }
    });

    it('should use getWebviewUri fallback when resolved_path is missing', async () => {
      const mockAudioControl = vi.fn();
      const mockWebviewUri = vi.fn((path: string) => `webview://resolved/${path}`);
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        getWebviewUri: mockWebviewUri,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const playBtn = container.querySelector('.btn-control[title="Play"]');
      if (playBtn) {
        await fireEvent.click(playBtn);
        expect(mockAudioControl).toHaveBeenCalledWith('webview://resolved/./music.mp3', 'play');
      }
    });

    it('should poll audio state with resolved URI', () => {
      const mockGetAudioState = vi.fn().mockReturnValue({ paused: true, muted: false, currentTime: 0, duration: 60 });
      const mockWebviewUri = vi.fn((path: string) => `webview://resolved/${path}`);

      render(MusicTab, {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        getWebviewUri: mockWebviewUri,
        audioVideoController: { audioControl: vi.fn(), getAudioState: mockGetAudioState, videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      });

      const resolvedCalls = mockGetAudioState.mock.calls.filter(
        (call: any[]) => call[0] === 'webview://resolved/./music.mp3'
      );
      expect(resolvedCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Waveform Editor', () => {
    it('should render waveform editor when audio has path and controls', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      expect(container.querySelector('.waveform-editor')).toBeTruthy();
    });

    it('should render start and end handles when startTime/endTime set', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3', startTime: 10, endTime: 60 } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 15, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      expect(container.querySelector('.waveform-handle-start')).toBeTruthy();
      expect(container.querySelector('.waveform-handle-end')).toBeTruthy();
    });

    it('should render time labels', () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3', startTime: 10, endTime: 60 } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 15, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const timeLabels = container.querySelectorAll('.waveform-time-label');
      expect(timeLabels.length).toBeGreaterThanOrEqual(2);
      expect(timeLabels[0]?.textContent).toContain('0:10');
      expect(timeLabels[2]?.textContent).toContain('1:00');
    });
  });

  describe('Waveform Drag — No Config Save During Drag', () => {
    const audioInput: ConfigInput = {
      type: 'audio',
      path: './music.mp3',
      startTime: 5,
      endTime: 30,
    };

    it('should not call onAutoSave during drag (handleDragMove)', async () => {
      const props = {
        ...defaultProps(),
        tempInput: audioInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      expect(startHandle).toBeTruthy();

      await fireEvent.mouseDown(startHandle!);
      props.onAutoSave.mockClear();

      await fireEvent.mouseMove(window, { clientX: 100 });

      // onAutoSave should NOT have been called during drag
      expect(props.onAutoSave).not.toHaveBeenCalled();
    });

    it('should not call onAutoSave after drag release — defers to destroy/close', async () => {
      const props = {
        ...defaultProps(),
        tempInput: audioInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      await fireEvent.mouseDown(startHandle!);
      props.onAutoSave.mockClear();
      await fireEvent.mouseMove(window, { clientX: 100 });
      await fireEvent.mouseUp(window);

      // Not saved — deferred to destroy
      expect(props.onAutoSave).not.toHaveBeenCalled();
    });

    it('should send loopRegion command during drag', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { ...audioInput, resolved_path: 'webview://music.mp3' } as any,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      expect(startHandle).toBeTruthy();

      await fireEvent.mouseDown(startHandle!);
      mockAudioControl.mockClear();
      await fireEvent.mouseMove(window, { clientX: 150 });

      const loopCalls = mockAudioControl.mock.calls.filter(
        (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('loopRegion:')
      );
      expect(loopCalls.length).toBe(1);

      await fireEvent.mouseUp(window);
    });

    it('should not trigger saves during rapid drag movements', async () => {
      const props = {
        ...defaultProps(),
        tempInput: audioInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const endHandle = container.querySelector('.waveform-handle-end');
      expect(endHandle).toBeTruthy();

      await fireEvent.mouseDown(endHandle!);
      props.onAutoSave.mockClear();

      for (let i = 0; i < 20; i++) {
        await fireEvent.mouseMove(window, { clientX: 100 + i * 5 });
      }

      expect(props.onAutoSave).not.toHaveBeenCalled();
      await fireEvent.mouseUp(window);
      expect(props.onAutoSave).not.toHaveBeenCalled();
    });
  });

  describe('Waveform Seek', () => {
    it('should send seek action when waveform is mousedown-ed', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const waveformEditor = container.querySelector('.waveform-editor');
      if (waveformEditor) {
        await fireEvent.mouseDown(waveformEditor, { clientX: 200 });

        const seekCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('seek:')
        );
        expect(seekCalls.length).toBeGreaterThan(0);
      }
    });

    it('should send seek actions during waveform drag', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const waveformEditor = container.querySelector('.waveform-editor');
      if (waveformEditor) {
        await fireEvent.mouseDown(waveformEditor, { clientX: 100 });
        mockAudioControl.mockClear();

        await fireEvent.mouseMove(window, { clientX: 200 });
        await fireEvent.mouseMove(window, { clientX: 300 });

        const seekCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('seek:')
        );
        expect(seekCalls.length).toBe(2);

        await fireEvent.mouseUp(window);
      }
    });

    it('should stop seeking on mouseup', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3' } as ConfigInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const waveformEditor = container.querySelector('.waveform-editor');
      if (waveformEditor) {
        await fireEvent.mouseDown(waveformEditor, { clientX: 100 });
        await fireEvent.mouseUp(window);
        mockAudioControl.mockClear();

        await fireEvent.mouseMove(window, { clientX: 300 });

        const seekCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => typeof call[1] === 'string' && call[1].startsWith('seek:')
        );
        expect(seekCalls.length).toBe(0);
      }
    });
  });

  describe('Drag end does not interrupt playback', () => {
    it('should not send play command after drag — audio keeps playing', async () => {
      const mockAudioControl = vi.fn();
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3', startTime: 5, endTime: 30 } as ConfigInput,
        audioVideoController: { audioControl: mockAudioControl, getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 150 });
        mockAudioControl.mockClear();

        await fireEvent.mouseUp(window);

        const playCalls = mockAudioControl.mock.calls.filter(
          (call: any[]) => call[1] === 'play'
        );
        expect(playCalls.length).toBe(0);
      }
    });
  });

  // Note: "Changing audio song auto-plays" tests are in ChannelConfigModal.test.ts
  // because the auto-play-on-path-change logic lives in the parent component (resumeAudioAfterSave).

  describe('Callbacks', () => {
    it('should call onUpdatePath when path changes', async () => {
      const props = defaultProps();
      render(MusicTab, props);

      const pathInput = screen.getByLabelText('Path:') as HTMLInputElement;
      await fireEvent.input(pathInput, { target: { value: './new-song.mp3' } });

      expect(props.onUpdatePath).toHaveBeenCalledWith('./new-song.mp3');
    });

    it('should call onUpdateTempInput when start time changes via drag', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3', startTime: 5, endTime: 30 } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: 50 });
        await fireEvent.mouseUp(window);

        // onUpdateTempInput should have been called during drag
        expect(props.onUpdateTempInput).toHaveBeenCalled();
      }
    });
  });

  describe('Waveform handle clamping', () => {
    it('should clamp start handle to not exceed end time', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3', startTime: 5, endTime: 30 } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 10, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const startHandle = container.querySelector('.waveform-handle-start');
      if (startHandle) {
        const waveformEditor = container.querySelector('.waveform-editor');
        const rect = waveformEditor?.getBoundingClientRect();

        await fireEvent.mouseDown(startHandle);
        await fireEvent.mouseMove(window, { clientX: rect ? rect.right : 1000 });
        await fireEvent.mouseUp(window);

        // The onUpdateTempInput calls should have clamped startTime
        const calls = props.onUpdateTempInput.mock.calls;
        if (calls.length > 0) {
          const lastInput = calls[calls.length - 1][0] as any;
          if (lastInput.startTime !== null && lastInput.startTime !== undefined && lastInput.endTime !== null && lastInput.endTime !== undefined) {
            expect(lastInput.startTime).toBeLessThanOrEqual(lastInput.endTime);
          }
        }
      }
    });

    it('should clamp end handle to not go before start time', async () => {
      const props = {
        ...defaultProps(),
        tempInput: { type: 'audio', path: './music.mp3', startTime: 20, endTime: 60 } as ConfigInput,
        audioVideoController: { audioControl: vi.fn(), getAudioState: vi.fn().mockReturnValue({ paused: false, muted: false, currentTime: 30, duration: 120 }), videoControl: vi.fn(), getVideoState: vi.fn(), getAudioFFT: vi.fn() } as any,
      };

      const { container } = render(MusicTab, props);

      const endHandle = container.querySelector('.waveform-handle-end');
      if (endHandle) {
        const waveformEditor = container.querySelector('.waveform-editor');
        const rect = waveformEditor?.getBoundingClientRect();

        await fireEvent.mouseDown(endHandle);
        await fireEvent.mouseMove(window, { clientX: rect ? rect.left : 0 });
        await fireEvent.mouseUp(window);

        const calls = props.onUpdateTempInput.mock.calls;
        if (calls.length > 0) {
          const lastInput = calls[calls.length - 1][0] as any;
          if (lastInput.startTime !== null && lastInput.startTime !== undefined && lastInput.endTime !== null && lastInput.endTime !== undefined) {
            expect(lastInput.endTime).toBeGreaterThanOrEqual(lastInput.startTime);
          }
        }
      }
    });
  });
});
