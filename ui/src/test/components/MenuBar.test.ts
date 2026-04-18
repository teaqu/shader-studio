import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import MenuBar from '../../lib/components/MenuBar.svelte';
import { resolutionStore } from '../../lib/stores/resolutionStore';

// Mock TransportFactory
vi.mock('../../lib/transport/TransportFactory', () => ({
  isVSCodeEnvironment: () => false
}));

/** Create a minimal mock ResolutionSessionController for tests. */
function createMockResCtrl() {
  return {
    menuVM: {
      syncWithConfig: true,
      targetKind: 'image' as const,
      targetLabel: 'Image',
      bufferResolutionState: { mode: 'none' as const, width: '', height: '', scale: 1 },
    },
    setSyncWithConfig: vi.fn(),
    setAspectRatio: vi.fn(),
    setImageScale: (scale: number) => resolutionStore.setScale(scale),
    setBufferScale: vi.fn(),
    setImageCustomResolution: (width?: string, height?: string) => {
      if (width && height) {
        resolutionStore.setCustomResolution(width, height);
      } else {
        resolutionStore.clearCustomResolution();
      }
    },
    resetCurrentTarget: () => resolutionStore.reset(),
    setBufferResolutionMode: vi.fn(),
    setBufferFixedResolution: vi.fn(),
    getCurrentTarget: () => ({ kind: 'image' as const }),
  };
}

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

  let mockResCtrl: ReturnType<typeof createMockResCtrl>;

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
    compileMode: 'hot' as const,
    onSetCompileMode: vi.fn(),
    onManualCompile: vi.fn(),
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

  function renderMenuBar(props: any = defaultProps) {
    return render(MenuBar, {
      props,
      context: new Map([['resolution', mockResCtrl]]),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockResCtrl = createMockResCtrl();
  });

  describe('volume slider', () => {
    it('should render volume slider in options menu and dispatch volume changes', async () => {
      renderMenuBar();
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
      renderMenuBar();
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
      renderMenuBar();
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
      renderMenuBar({ ...defaultProps, audioMuted: true });
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
      renderMenuBar({ ...defaultProps, audioMuted: false });
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

  describe('resolution menu', () => {
    it('should use number inputs for custom resolution width and height', async () => {
      renderMenuBar();
      await tick();

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      await tick();

      const inputs = document.querySelectorAll('input.custom-res-input');
      expect(inputs).toHaveLength(2);
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).type).toBe('number');
      });
    });

    it('should apply custom resolution automatically when both inputs have values', async () => {
      renderMenuBar();
      await tick();

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      await tick();

      const [widthInput, heightInput] = Array.from(document.querySelectorAll('input.custom-res-input')) as HTMLInputElement[];
      await fireEvent.input(widthInput, { target: { valueAsNumber: 320 } });
      await fireEvent.input(heightInput, { target: { valueAsNumber: 240 } });
      await tick();

      let state: any;
      const unsubscribe = resolutionStore.subscribe((v) => {
        state = v; 
      });
      unsubscribe();
      expect(state.customWidth).toBe('320');
      expect(state.customHeight).toBe('240');

      resolutionStore.clearCustomResolution();
    });

    it('should not have an Apply button', async () => {
      renderMenuBar();
      await tick();

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      await tick();

      expect(screen.queryByText('Apply')).toBeNull();
    });

    it('should preserve custom resolution when resolution scale is changed', async () => {
      renderMenuBar();
      await tick();

      resolutionStore.setCustomResolution('320', '240');
      await tick();

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      await tick();

      const scaleButton = screen.getByText('2x');
      await fireEvent.click(scaleButton);
      await tick();

      let state: any;
      const unsubscribe = resolutionStore.subscribe((v) => {
        state = v; 
      });
      unsubscribe();
      expect(state.customWidth).toBe('320');
      expect(state.customHeight).toBe('240');
      expect(state.scale).toBe(2);

      resolutionStore.clearCustomResolution();
      resolutionStore.setScale(1);
    });

    it('should toggle black canvas background from the resolution menu', async () => {
      renderMenuBar();
      await tick();

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      await tick();

      const toggle = screen.getByLabelText('Black canvas background') as HTMLInputElement;
      expect(toggle.checked).toBe(false);

      await fireEvent.click(toggle);
      await tick();

      let state: any;
      const unsubscribe = resolutionStore.subscribe((value) => {
        state = value;
      });
      unsubscribe();
      expect(state.forceBlackBackground).toBe(true);
    });
  });

  describe('compile mode', () => {
    it('sets hot/save/manual compile mode from the inline selector', async () => {
      renderMenuBar();
      await tick();

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      const hotButton = screen.getByLabelText('Set hot compile mode');
      const saveButton = screen.getByLabelText('Set save compile mode');
      const manualButton = screen.getByLabelText('Set manual compile mode');

      expect(hotButton.getAttribute('title')).toBe('Hot compile mode');

      await fireEvent.click(saveButton);
      await fireEvent.click(manualButton);

      expect(defaultProps.onSetCompileMode).toHaveBeenNthCalledWith(1, 'save');
      expect(defaultProps.onSetCompileMode).toHaveBeenNthCalledWith(2, 'manual');
    });

    it('shows manual compile action only in the options menu for manual mode', async () => {
      renderMenuBar({ ...defaultProps, compileMode: 'manual' as const });
      await tick();

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      await tick();

      const compileButton = screen.getByLabelText('Compile shader');
      expect(compileButton).toBeTruthy();

      await fireEvent.click(compileButton);
      expect(defaultProps.onManualCompile).toHaveBeenCalledTimes(1);
    });
  });
});
