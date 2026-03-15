import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import MenuBar from '../../lib/components/MenuBar.svelte';

// Mock TransportFactory
vi.mock('../../lib/transport/TransportFactory', () => ({
  isVSCodeEnvironment: () => false
}));



describe('MenuBar', () => {
  const mockTimeManager = {
    getCurrentTime: () => 0.0,
    isPaused: () => false,
    getSpeed: () => 1.0,
    setSpeed: vi.fn(),
    isLoopEnabled: () => false,
    setLoopEnabled: vi.fn(),
    getLoopDuration: () => Math.PI * 2,
    setLoopDuration: vi.fn(),
    setTime: vi.fn(),
  };

  const defaultProps = {
    timeManager: mockTimeManager,
    currentFPS: 60,
    canvasWidth: 800,
    canvasHeight: 600,
    isLocked: false,
    errors: [] as string[],
    canvasElement: null,
    onReset: vi.fn(),
    onRefresh: vi.fn(),
    onTogglePause: vi.fn(),
    onToggleLock: vi.fn(),
    onAspectRatioChange: vi.fn(),
    onZoomChange: vi.fn(),
    onFpsLimitChange: vi.fn(),
    onConfig: vi.fn(),
    isDebugEnabled: false,
    onToggleDebugEnabled: vi.fn(),
    debugState: null,
    isConfigPanelVisible: false,
    onToggleConfigPanel: vi.fn(),
    isEditorOverlayVisible: false,
    onToggleEditorOverlay: vi.fn(),
    isVimModeEnabled: false,
    onToggleVimMode: vi.fn(),
    onFork: vi.fn(),
    onExtensionCommand: vi.fn(),
    hasShader: true,
    onResetLayout: vi.fn(),
    previewVisible: true,
    onShowPreview: vi.fn(),
    audioVolume: 0.75,
    audioMuted: false,
    audioVideoController: {
      setVolume: vi.fn(),
      toggleMute: vi.fn(),
      videoControl: vi.fn(),
      getVideoState: vi.fn(),
      audioControl: vi.fn(),
      getAudioState: vi.fn(),
      getAudioFFT: vi.fn(),
      volume: 0.75,
      muted: false,
      dispose: vi.fn(),
    } as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('volume slider', () => {
    it('should render volume slider in options menu and dispatch volume changes', async () => {
      render(MenuBar, { props: defaultProps });
      await tick();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Volume slider should exist
      const volumeSlider = screen.getByLabelText('Volume') as HTMLInputElement;
      expect(volumeSlider).toBeTruthy();
      expect(volumeSlider.value).toBe('0.75');

      // Change the volume
      await fireEvent.input(volumeSlider, { target: { value: '0.3' } });
      await tick();

      expect(defaultProps.audioVideoController.setVolume).toHaveBeenCalledWith(0.3);
    });

    it('should display volume percentage label', async () => {
      render(MenuBar, { props: defaultProps });
      await tick();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Volume label should show 75%
      const volumeLabel = document.querySelector('.volume-label');
      expect(volumeLabel?.textContent).toBe('75%');
    });
  });

  describe('mute button', () => {
    it('should render mute button and dispatch mute toggle', async () => {
      render(MenuBar, { props: defaultProps });
      await tick();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      // Mute button should exist
      const muteButton = screen.getByLabelText('Toggle mute');
      expect(muteButton).toBeTruthy();

      // Click to toggle mute
      await fireEvent.click(muteButton);
      await tick();

      expect(defaultProps.audioVideoController.toggleMute).toHaveBeenCalledTimes(1);
    });

    it('should show muted appearance when audioMuted is true', async () => {
      render(MenuBar, { props: { ...defaultProps, audioMuted: true } });
      await tick();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      const muteButton = screen.getByLabelText('Toggle mute');
      expect(muteButton.classList.contains('muted')).toBe(true);

      // Volume slider should have muted-slider class
      const volumeSlider = screen.getByLabelText('Volume');
      expect(volumeSlider.classList.contains('muted-slider')).toBe(true);
    });

    it('should show unmuted appearance when audioMuted is false', async () => {
      render(MenuBar, { props: { ...defaultProps, audioMuted: false } });
      await tick();

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      const muteButton = screen.getByLabelText('Toggle mute');
      expect(muteButton.classList.contains('muted')).toBe(false);

      // Volume slider should NOT have muted-slider class
      const volumeSlider = screen.getByLabelText('Volume');
      expect(volumeSlider.classList.contains('muted-slider')).toBe(false);
    });
  });
});
