import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import MenuBar from '../lib/components/MenuBar.svelte';
import { currentTheme } from '../lib/stores/themeStore';
import { aspectRatioStore } from '../lib/stores/aspectRatioStore';
import { resolutionStore } from '../lib/stores/resolutionStore';

// Mock the transport factory
vi.mock('../lib/transport/TransportFactory', () => ({
  isVSCodeEnvironment: vi.fn().mockReturnValue(false)
}));

describe('MenuBar Component', () => {
  let mockTimeManager: any;
  let mockCanvas: HTMLCanvasElement;
  let defaultProps: any;

  beforeEach(() => {
    mockTimeManager = {
      getCurrentTime: vi.fn().mockReturnValue(5.25),
      isPaused: vi.fn().mockReturnValue(false),
      getSpeed: vi.fn().mockReturnValue(1.0),
      setSpeed: vi.fn(),
      isLoopEnabled: vi.fn().mockReturnValue(false),
      setLoopEnabled: vi.fn(),
      getLoopDuration: vi.fn().mockReturnValue(60),
      setLoopDuration: vi.fn(),
      setTime: vi.fn()
    };

    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 800;
    mockCanvas.height = 600;

    defaultProps = {
      timeManager: null,
      currentFPS: 60.0,
      canvasWidth: 800,
      canvasHeight: 600,
      isLocked: false,
      canvasElement: null,
      onReset: vi.fn(),
      onRefresh: vi.fn(),
      onTogglePause: vi.fn(),
      onToggleLock: vi.fn(),
      onAspectRatioChange: vi.fn(),
      onZoomChange: vi.fn(),
      onFpsLimitChange: vi.fn(),
      isDebugEnabled: false,
      onToggleDebugEnabled: vi.fn(),
      debugState: {
        isEnabled: false,
        currentLine: null,
        lineContent: null,
        filePath: null,
        isActive: false
      },
      isConfigPanelVisible: false,
      onToggleConfigPanel: vi.fn(),
      onConfig: vi.fn(),
      isEditorOverlayVisible: false,
      onToggleEditorOverlay: vi.fn(),
      isVimModeEnabled: false,
      onToggleVimMode: vi.fn(),
      onFork: vi.fn()
    };

    // Reset all mocks
    vi.clearAllMocks();

    // Reset stores to default values
    currentTheme.set('light');
    aspectRatioStore.setMode('16:9');
    resolutionStore.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render the menu bar with basic controls', () => {
      render(MenuBar, { props: defaultProps });
      
      expect(screen.getByLabelText('Reset shader')).toBeInTheDocument();
      expect(screen.getByLabelText('Toggle pause')).toBeInTheDocument();
      expect(screen.getByLabelText('Toggle lock')).toBeInTheDocument();
      expect(screen.getByLabelText('Open options menu')).toBeInTheDocument();
    });

    it('should display FPS and canvas dimensions', () => {
      render(MenuBar, { props: defaultProps });

      expect(screen.getByLabelText('Change FPS limit')).toHaveTextContent('60');
      expect(screen.getByText('800 × 600')).toBeInTheDocument();
    });

    it('should display current time when timeManager is provided', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          timeManager: mockTimeManager
        }
      });

      expect(screen.getByText('5.25s')).toBeInTheDocument();
    });
  });

  describe('Lock State', () => {
    it('should show unlock icon when not locked', () => {
      render(MenuBar, { props: { ...defaultProps, isLocked: false } });
      
      const lockButton = screen.getByLabelText('Toggle lock');
      expect(lockButton).toBeInTheDocument();
    });

    it('should show lock icon when locked', () => {
      render(MenuBar, { props: { ...defaultProps, isLocked: true } });
      
      const lockButton = screen.getByLabelText('Toggle lock');
      expect(lockButton).toBeInTheDocument();
    });

    it('should call onToggleLock when lock button is clicked', async () => {
      const onToggleLock = vi.fn();
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          onToggleLock 
        } 
      });
      
      const lockButton = screen.getByLabelText('Toggle lock');
      await fireEvent.click(lockButton);
      
      expect(onToggleLock).toHaveBeenCalledOnce();
    });
  });

  describe('Pause/Play Toggle', () => {
    it('should show play icon when paused', () => {
      mockTimeManager.isPaused.mockReturnValue(true);
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          timeManager: mockTimeManager 
        } 
      });
      
      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton).toBeInTheDocument();
    });

    it('should show pause icon when playing', () => {
      mockTimeManager.isPaused.mockReturnValue(false);
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          timeManager: mockTimeManager 
        } 
      });
      
      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton).toBeInTheDocument();
    });

    it('should call onTogglePause when pause button is clicked', async () => {
      const onTogglePause = vi.fn();
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          onTogglePause 
        } 
      });
      
      const pauseButton = screen.getByLabelText('Toggle pause');
      await fireEvent.click(pauseButton);
      
      expect(onTogglePause).toHaveBeenCalledOnce();
    });
  });

  describe('Reset Button', () => {
    it('should call onReset when reset button is clicked', async () => {
      const onReset = vi.fn();
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          onReset 
        } 
      });
      
      const resetButton = screen.getByLabelText('Reset shader');
      await fireEvent.click(resetButton);
      
      expect(onReset).toHaveBeenCalledOnce();
    });
  });

  describe('Options Menu', () => {
    it('should show options menu when three-dots button is clicked', async () => {
      render(MenuBar, { props: defaultProps });
      
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      expect(screen.getByLabelText('Refresh shader')).toBeInTheDocument();
    });

    it('should hide options menu when clicking outside', async () => {
      render(MenuBar, { props: defaultProps });
      
      // Open menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      expect(screen.getByLabelText('Refresh shader')).toBeInTheDocument();
      
      // Click outside
      await fireEvent.click(document.body);
      
      expect(screen.queryByLabelText('Refresh shader')).not.toBeInTheDocument();
    });

    it('should call onRefresh when refresh button is clicked', async () => {
      const onRefresh = vi.fn();
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          onRefresh 
        } 
      });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      // Click refresh
      const refreshButton = screen.getByLabelText('Refresh shader');
      await fireEvent.click(refreshButton);
      
      expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('should keep menu open when refresh is clicked', async () => {
      const onRefresh = vi.fn();
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          onRefresh 
        } 
      });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      // Click refresh
      const refreshButton = screen.getByLabelText('Refresh shader');
      await fireEvent.click(refreshButton);
      
      // Menu should be closed (refresh button should no longer be visible)
      expect(screen.queryByLabelText('Refresh shader')).not.toBeInTheDocument();
    });
  });

  describe('Theme Toggle', () => {
    it('should show theme toggle button in non-VSCode environment', () => {
      render(MenuBar, { props: defaultProps });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      fireEvent.click(optionsButton);
      
      expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument();
    });

    it('should show "Dark Mode" text when in light theme', async () => {
      currentTheme.set('light');
      render(MenuBar, { props: defaultProps });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      expect(screen.getByText('Dark Mode')).toBeInTheDocument();
    });

    it('should show "Light Mode" text when in dark theme', async () => {
      currentTheme.set('dark');
      render(MenuBar, { props: defaultProps });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      expect(screen.getByText('Light Mode')).toBeInTheDocument();
    });

    it('should keep menu open when theme is toggled', async () => {
      render(MenuBar, { props: defaultProps });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      // Click theme toggle
      const themeButton = screen.getByLabelText('Toggle theme');
      await fireEvent.click(themeButton);
      
      // Menu should still be visible
      expect(screen.getByLabelText('Toggle theme')).toBeInTheDocument();
    });
  });

  describe('Fullscreen Toggle', () => {
    it('should show fullscreen button in non-VSCode environment', async () => {
      render(MenuBar, { props: defaultProps });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      expect(screen.getByLabelText('Toggle fullscreen')).toBeInTheDocument();
    });

    it('should call requestFullscreen when fullscreen button is clicked', async () => {
      const requestFullscreenMock = vi.fn();
      const canvasParent = document.createElement('div');
      canvasParent.classList.add('canvas-container');
      canvasParent.requestFullscreen = requestFullscreenMock;
      canvasParent.appendChild(mockCanvas);

      render(MenuBar, {
        props: {
          ...defaultProps,
          canvasElement: mockCanvas
        }
      });

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      // Click fullscreen
      const fullscreenButton = screen.getByLabelText('Toggle fullscreen');
      await fireEvent.click(fullscreenButton);

      expect(requestFullscreenMock).toHaveBeenCalled();
    });
  });

  describe('Resolution Menu', () => {
    it('should show resolution menu when resolution button is clicked', async () => {
      render(MenuBar, { props: defaultProps });
      
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      
      expect(screen.getByText('Resolution Scale')).toBeInTheDocument();
      expect(screen.getByText('Aspect Ratio')).toBeInTheDocument();
      expect(screen.getByText('Zoom')).toBeInTheDocument();
    });

    it('should close options menu when resolution menu is opened', async () => {
      render(MenuBar, { props: defaultProps });
      
      // Open options menu first
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      expect(screen.getByLabelText('Refresh shader')).toBeInTheDocument();
      
      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      
      // Options menu should be closed
      expect(screen.queryByLabelText('Refresh shader')).not.toBeInTheDocument();
      // Resolution menu should be open
      expect(screen.getByText('Resolution Scale')).toBeInTheDocument();
    });

    it('should update resolution store when scale option is selected', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
        }
      });

      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      // Click 0.5x scale
      const halfButton = screen.getByRole('button', { name: '0.5x' });
      await fireEvent.click(halfButton);

      const { get } = await import('svelte/store');
      const state = get(resolutionStore);
      expect(state.scale).toBe(0.5);
    });

    it('should call onAspectRatioChange when aspect ratio is selected', async () => {
      const onAspectRatioChange = vi.fn();
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          onAspectRatioChange 
        } 
      });
      
      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      
      // Click 4:3 aspect ratio
      const aspectButton = screen.getByRole('button', { name: '4:3' });
      await fireEvent.click(aspectButton);
      
      expect(onAspectRatioChange).toHaveBeenCalledWith('4:3');
    });

    it('should call onZoomChange when zoom slider is moved', async () => {
      const onZoomChange = vi.fn();
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          onZoomChange 
        } 
      });
      
      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      
      // Change zoom
      const zoomSlider = screen.getByDisplayValue('1');
      await fireEvent.input(zoomSlider, { target: { value: '2.0' } });
      
      expect(onZoomChange).toHaveBeenCalledWith(2.0);
    });

    it('should show custom resolution inputs', async () => {
      render(MenuBar, { props: defaultProps });
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      expect(screen.getByText('Custom Resolution')).toBeInTheDocument();
      const inputs = screen.getAllByPlaceholderText('px or %');
      expect(inputs).toHaveLength(2);
    });

    it('should enable Apply button only when both custom inputs are filled', async () => {
      render(MenuBar, { props: defaultProps });
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const applyButton = screen.getByRole('button', { name: 'Apply' });
      expect(applyButton).toBeDisabled();

      const inputs = screen.getAllByPlaceholderText('px or %');
      await fireEvent.input(inputs[0], { target: { value: '1920' } });
      await fireEvent.input(inputs[1], { target: { value: '1080' } });

      expect(applyButton).not.toBeDisabled();
    });

    it('should update resolution store with percentage values when Apply is clicked', async () => {
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const inputs = screen.getAllByPlaceholderText('px or %');
      await fireEvent.input(inputs[0], { target: { value: '50%' } });
      await fireEvent.input(inputs[1], { target: { value: '50%' } });

      const applyButton = screen.getByRole('button', { name: 'Apply' });
      await fireEvent.click(applyButton);

      const { get } = await import('svelte/store');
      const state = get(resolutionStore);
      expect(state.customWidth).toBe('50%');
      expect(state.customHeight).toBe('50%');
    });

    it('should update resolution store with px values when Apply is clicked', async () => {
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const inputs = screen.getAllByPlaceholderText('px or %');
      await fireEvent.input(inputs[0], { target: { value: '1920' } });
      await fireEvent.input(inputs[1], { target: { value: '1080' } });

      const applyButton = screen.getByRole('button', { name: 'Apply' });
      await fireEvent.click(applyButton);

      const { get } = await import('svelte/store');
      const state = get(resolutionStore);
      expect(state.customWidth).toBe('1920');
      expect(state.customHeight).toBe('1080');
    });

    it('should show Clear button when custom resolution is active', async () => {
      resolutionStore.setCustomResolution('512', '512');
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('should clear custom resolution in store when Clear is clicked', async () => {
      resolutionStore.setCustomResolution('512', '512');
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const clearButton = screen.getByRole('button', { name: 'Clear' });
      await fireEvent.click(clearButton);

      const { get } = await import('svelte/store');
      const state = get(resolutionStore);
      expect(state.customWidth).toBeUndefined();
      expect(state.customHeight).toBeUndefined();
    });

    it('should disable scale buttons when custom resolution is active', async () => {
      resolutionStore.setCustomResolution('512', '512');
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const scaleButton = screen.getByRole('button', { name: '1x' });
      expect(scaleButton).toBeDisabled();
    });

    it('should disable aspect ratio buttons when custom resolution is active', async () => {
      resolutionStore.setCustomResolution('512', '512');
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const aspectButton = screen.getByRole('button', { name: '16:9' });
      expect(aspectButton).toBeDisabled();
    });

    it('should show Save to shader config checkbox', async () => {
      render(MenuBar, { props: defaultProps });
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      expect(screen.getByText('Save to shader config')).toBeInTheDocument();
    });

    it('should have a Save to shader config checkbox', async () => {
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const checkbox = screen.getByText('Save to shader config').closest('label')!.querySelector('input')!;
      expect(checkbox).toBeInTheDocument();
    });

    it('should show checked checkbox when savedToConfig is true', async () => {
      resolutionStore.setSavedToConfig(true);
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const checkbox = screen.getByText('Save to shader config').closest('label')!.querySelector('input')!;
      expect(checkbox.checked).toBe(true);
    });

    it('should show all scale options', async () => {
      render(MenuBar, { props: defaultProps });
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      expect(screen.getByRole('button', { name: '0.25x' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '0.5x' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1x' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '2x' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '4x' })).toBeInTheDocument();
    });

    it('should show all aspect ratio options', async () => {
      render(MenuBar, { props: defaultProps });
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      expect(screen.getByRole('button', { name: '16:9' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '4:3' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1:1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Fill' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Auto' })).toBeInTheDocument();
    });

    it('should highlight active scale', async () => {
      resolutionStore.setScale(2);
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const twoXButton = screen.getByRole('button', { name: '2x' });
      expect(twoXButton.classList.contains('active')).toBe(true);
    });
  });

  describe('Resolution Reset', () => {
    it('should show reset button in resolution menu', async () => {
      render(MenuBar, { props: defaultProps });
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
      expect(resetButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('should reset resolution store when resolution reset is clicked', async () => {
      resolutionStore.setScale(4);
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      // The resolution reset is the first Reset button (in save-to-config section)
      const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
      await fireEvent.click(resetButtons[0]);

      const { get } = await import('svelte/store');
      const state = get(resolutionStore);
      expect(state.scale).toBe(1);
    });

    it('should reset resolution store when resolution reset is clicked', async () => {
      resolutionStore.setScale(4);
      resolutionStore.setCustomResolution('1920', '1080');

      render(MenuBar, { props: { ...defaultProps } });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
      await fireEvent.click(resetButtons[0]);

      const { get } = await import('svelte/store');
      const state = get(resolutionStore);
      expect(state.scale).toBe(1);
      expect(state.customWidth).toBeUndefined();
      expect(state.customHeight).toBeUndefined();
    });

    it('should NOT uncheck save to shader config when reset is clicked', async () => {
      resolutionStore.setSavedToConfig(true);
      resolutionStore.setScale(4);

      render(MenuBar, { props: { ...defaultProps } });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
      await fireEvent.click(resetButtons[0]);

      const { get } = await import('svelte/store');
      const state = get(resolutionStore);
      expect(state.savedToConfig).toBe(true);
    });

    it('should reset aspect ratio to fill when resolution reset is clicked', async () => {
      aspectRatioStore.setMode('4:3');

      render(MenuBar, { props: { ...defaultProps } });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
      await fireEvent.click(resetButtons[0]);

      const { get } = await import('svelte/store');
      const state = get(aspectRatioStore);
      expect(state.mode).toBe('auto');
    });
  });

  describe('Zoom Reset', () => {
    it('should show reset button next to zoom header', async () => {
      render(MenuBar, { props: defaultProps });
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      // There should be two Reset buttons: one for resolution, one for zoom
      const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
      expect(resetButtons.length).toBe(2);
    });

    it('should call onZoomChange with 1.0 when zoom reset is clicked', async () => {
      const onZoomChange = vi.fn();
      render(MenuBar, { props: { ...defaultProps, onZoomChange } });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      // First change zoom to something else
      const zoomSlider = screen.getByDisplayValue('1');
      await fireEvent.input(zoomSlider, { target: { value: '2.5' } });
      onZoomChange.mockClear();

      // Click zoom reset (second Reset button)
      const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
      await fireEvent.click(resetButtons[1]);

      expect(onZoomChange).toHaveBeenCalledWith(1.0);
    });

    it('should reset zoom slider value to 1.0', async () => {
      render(MenuBar, { props: defaultProps });

      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);

      // Change zoom
      const zoomSlider = screen.getByDisplayValue('1') as HTMLInputElement;
      await fireEvent.input(zoomSlider, { target: { value: '2.5' } });

      // Click zoom reset
      const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
      await fireEvent.click(resetButtons[1]);

      expect(screen.getByText('Zoom: 1.0x')).toBeInTheDocument();
    });
  });

  describe('FPS Menu', () => {
    it('should show FPS menu when FPS button is clicked', async () => {
      render(MenuBar, { props: defaultProps });

      const fpsButton = screen.getByLabelText('Change FPS limit');
      await fireEvent.click(fpsButton);

      expect(screen.getByText('Frame Rate Limit')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '30 FPS' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '60 FPS' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unlimited' })).toBeInTheDocument();
    });

    it('should call onFpsLimitChange when limit is selected', async () => {
      const onFpsLimitChange = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          onFpsLimitChange,
        },
      });

      const fpsButton = screen.getByLabelText('Change FPS limit');
      await fireEvent.click(fpsButton);
      await fireEvent.click(screen.getByRole('button', { name: '30 FPS' }));
      await fireEvent.click(screen.getByRole('button', { name: '60 FPS' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Unlimited' }));

      expect(onFpsLimitChange).toHaveBeenNthCalledWith(1, 30);
      expect(onFpsLimitChange).toHaveBeenNthCalledWith(2, 60);
      expect(onFpsLimitChange).toHaveBeenNthCalledWith(3, 0);
    });

    it('should close FPS menu when clicking outside', async () => {
      render(MenuBar, { props: defaultProps });

      const fpsButton = screen.getByLabelText('Change FPS limit');
      await fireEvent.click(fpsButton);
      expect(screen.getByText('Frame Rate Limit')).toBeInTheDocument();

      await fireEvent.click(document.body);
      expect(screen.queryByText('Frame Rate Limit')).not.toBeInTheDocument();
    });

    it('should show Frame Times button in FPS menu', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isPerformancePanelVisible: false,
          onTogglePerformancePanel: vi.fn(),
        },
      });

      const fpsButton = screen.getByLabelText('Change FPS limit');
      await fireEvent.click(fpsButton);

      expect(screen.getByText('Frame Times')).toBeInTheDocument();
    });

    it('should call onTogglePerformancePanel when Frame Times is clicked', async () => {
      const onTogglePerformancePanel = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          isPerformancePanelVisible: false,
          onTogglePerformancePanel,
        },
      });

      const fpsButton = screen.getByLabelText('Change FPS limit');
      await fireEvent.click(fpsButton);
      await fireEvent.click(screen.getByText('Frame Times'));

      expect(onTogglePerformancePanel).toHaveBeenCalledOnce();
    });

    it('should close FPS menu after clicking Frame Times', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isPerformancePanelVisible: false,
          onTogglePerformancePanel: vi.fn(),
        },
      });

      const fpsButton = screen.getByLabelText('Change FPS limit');
      await fireEvent.click(fpsButton);
      await fireEvent.click(screen.getByText('Frame Times'));

      expect(screen.queryByText('Frame Rate Limit')).not.toBeInTheDocument();
    });

    it('should show Frame Times button as active when performance panel is visible', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isPerformancePanelVisible: true,
          onTogglePerformancePanel: vi.fn(),
        },
      });

      const fpsButton = screen.getByLabelText('Change FPS limit');
      await fireEvent.click(fpsButton);

      const frameTimesBtn = screen.getByText('Frame Times');
      expect(frameTimesBtn).toHaveClass('active');
    });

    it('should show Frame Times button as inactive when performance panel is not visible', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isPerformancePanelVisible: false,
          onTogglePerformancePanel: vi.fn(),
        },
      });

      const fpsButton = screen.getByLabelText('Change FPS limit');
      await fireEvent.click(fpsButton);

      const frameTimesBtn = screen.getByText('Frame Times');
      expect(frameTimesBtn).not.toHaveClass('active');
    });
  });

  describe('Menu Interactions', () => {
    it('should close resolution menu when clicking outside', async () => {
      render(MenuBar, { props: defaultProps });
      
      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      expect(screen.getByText('Resolution Scale')).toBeInTheDocument();

      // Click outside
      await fireEvent.click(document.body);

      expect(screen.queryByText('Resolution Scale')).not.toBeInTheDocument();
    });

    it('should close options menu when resolution menu is opened', async () => {
      render(MenuBar, { props: defaultProps });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      
      // Options menu should be closed
      expect(screen.queryByLabelText('Refresh shader')).not.toBeInTheDocument();
    });

    it('should close resolution menu when options menu is opened', async () => {
      render(MenuBar, { props: defaultProps });
      
      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      // Resolution menu should be closed
      expect(screen.queryByText('Quality')).not.toBeInTheDocument();
    });
  });

  describe('VSCode Environment', () => {
    it('should hide theme and fullscreen buttons in VSCode environment', async () => {
      // Mock VSCode environment
      const { isVSCodeEnvironment } = await import('../lib/transport/TransportFactory');
      vi.mocked(isVSCodeEnvironment).mockReturnValue(true);
      
      render(MenuBar, { props: defaultProps });
      
      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);
      
      expect(screen.queryByLabelText('Toggle theme')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Toggle fullscreen')).not.toBeInTheDocument();
      
      // Reset mock
      vi.mocked(isVSCodeEnvironment).mockReturnValue(false);
    });
  });

  describe('Lock/Refresh Functionality', () => {
    it('should call onRefresh when unlocking (transitioning from locked to unlocked)', async () => {
      // Start with locked state
      const { rerender } = render(MenuBar, { 
        props: { ...defaultProps, isLocked: true } 
      });

      // Find the lock button
      const lockButton = screen.getByLabelText('Toggle lock');
      
      // Click to unlock (should trigger refresh)
      await fireEvent.click(lockButton);

      // Verify both onToggleLock and onRefresh were called
      expect(defaultProps.onToggleLock).toHaveBeenCalledTimes(1);
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onRefresh when locking (transitioning from unlocked to locked)', async () => {
      // Start with unlocked state
      render(MenuBar, { 
        props: { ...defaultProps, isLocked: false } 
      });

      // Find the lock button
      const lockButton = screen.getByLabelText('Toggle lock');
      
      // Click to lock (should NOT trigger refresh)
      await fireEvent.click(lockButton);

      // Verify onToggleLock was called but onRefresh was NOT
      expect(defaultProps.onToggleLock).toHaveBeenCalledTimes(1);
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(0);
    });

    it('should call onRefresh and close options menu when refresh button is clicked', async () => {
      render(MenuBar, { props: defaultProps });

      // First open the options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      // Find and click the refresh button
      const refreshButton = screen.getByLabelText('Refresh shader');
      await fireEvent.click(refreshButton);

      // Verify onRefresh was called
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
      
      // Verify options menu is closed (should not find refresh button anymore)
      expect(screen.queryByLabelText('Refresh shader')).not.toBeInTheDocument();
    });

    it('should handle multiple lock/unlock cycles correctly', async () => {
      // Start unlocked
      const { rerender } = render(MenuBar, { 
        props: { ...defaultProps, isLocked: false } 
      });

      const lockButton = screen.getByLabelText('Toggle lock');
      
      // First click: unlock → lock (no refresh)
      await fireEvent.click(lockButton);
      expect(defaultProps.onToggleLock).toHaveBeenCalledTimes(1);
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(0);

      // Update props to reflect locked state (simulating parent component update)
      await rerender({ ...defaultProps, isLocked: true });

      // Second click: lock → unlock (should refresh)
      await fireEvent.click(lockButton);
      expect(defaultProps.onToggleLock).toHaveBeenCalledTimes(2);
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);

      // Update props to reflect unlocked state
      await rerender({ ...defaultProps, isLocked: false });

      // Third click: unlock → lock (no refresh)
      await fireEvent.click(lockButton);
      expect(defaultProps.onToggleLock).toHaveBeenCalledTimes(3);
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1); // Still only 1 refresh
    });

    it('should maintain correct behavior regardless of initial lock state', async () => {
      // Test starting from locked state
      const { unmount } = render(MenuBar, { 
        props: { ...defaultProps, isLocked: true } 
      });

      const lockButton = screen.getByLabelText('Toggle lock');
      
      // First unlock should trigger refresh
      await fireEvent.click(lockButton);
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);

      // Clean up first component
      unmount();

      // Reset mocks and test starting from unlocked state
      vi.clearAllMocks();
      
      const { unmount: unmount2 } = render(MenuBar, { 
        props: { ...defaultProps, isLocked: false } 
      });

      const lockButton2 = screen.getByLabelText('Toggle lock');
      
      // First lock should not trigger refresh
      await fireEvent.click(lockButton2);
      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(0);
      
      unmount2();
    });
  });

  describe('Config Panel Button', () => {
    it('should call onToggleConfigPanel when config panel button is clicked and hasShader', async () => {
      const onToggleConfigPanel = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          hasShader: true,
          onToggleConfigPanel
        }
      });

      const configButton = screen.getByLabelText('Toggle config panel');
      await fireEvent.click(configButton);

      expect(onToggleConfigPanel).toHaveBeenCalledTimes(1);
    });

    it('should be disabled when hasShader is false', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          hasShader: false,
        }
      });

      const configButton = screen.getByLabelText('Toggle config panel');
      expect(configButton).toBeDisabled();
    });

    it('should show active state when config panel is visible', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          hasShader: true,
          isConfigPanelVisible: true
        }
      });

      const configButton = screen.getByLabelText('Toggle config panel');
      expect(configButton.classList.contains('active')).toBe(true);
    });

    it('should not show active state when config panel is hidden', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isConfigPanelVisible: false
        }
      });

      const configButton = screen.getByLabelText('Toggle config panel');
      expect(configButton.classList.contains('active')).toBe(false);
    });
  });

  describe('Debug Button Disabled State', () => {
    it('should be disabled when hasShader is false', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          hasShader: false,
        }
      });

      const debugButton = screen.getByLabelText('Toggle debug mode');
      expect(debugButton).toBeDisabled();
    });

    it('should be enabled when hasShader is true', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          hasShader: true,
        }
      });

      const debugButton = screen.getByLabelText('Toggle debug mode');
      expect(debugButton).not.toBeDisabled();
    });

    it('should disable debug and config in options menu when hasShader is false', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          hasShader: false,
        }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const debugButtons = screen.getAllByLabelText('Toggle debug mode');
      const configButtons = screen.getAllByLabelText('Toggle config panel');
      // The menu versions (last ones) should be disabled
      expect(debugButtons[debugButtons.length - 1]).toBeDisabled();
      expect(configButtons[configButtons.length - 1]).toBeDisabled();
    });
  });

  describe('Editor Overlay in Options Menu', () => {
    it('should show Editor option in options menu', async () => {
      render(MenuBar, { props: defaultProps });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      expect(screen.getByText('Editor')).toBeInTheDocument();
    });

    it('should call onToggleEditorOverlay from main toolbar button', async () => {
      const onToggleEditorOverlay = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          onToggleEditorOverlay
        }
      });

      const editorButton = screen.getByLabelText('Toggle editor overlay');
      await fireEvent.click(editorButton);

      expect(onToggleEditorOverlay).toHaveBeenCalled();
    });

    it('should call onToggleEditorOverlay from options menu', async () => {
      const onToggleEditorOverlay = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          onToggleEditorOverlay
        }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const editorButtons = screen.getAllByLabelText('Toggle editor overlay');
      // Click the one inside the options menu (second one)
      await fireEvent.click(editorButtons[editorButtons.length - 1]);

      expect(onToggleEditorOverlay).toHaveBeenCalled();
    });

    it('should show active state on editor button when overlay is visible', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isEditorOverlayVisible: true
        }
      });

      const editorButton = screen.getByLabelText('Toggle editor overlay');
      expect(editorButton.classList.contains('active')).toBe(true);
    });
  });

  describe('Vim Mode Toggle', () => {
    it('should show vim mode toggle in options menu when editor is visible', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isEditorOverlayVisible: true
        }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      expect(screen.getByText('Vim Mode')).toBeInTheDocument();
    });

    it('should not show vim mode toggle when editor is hidden', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isEditorOverlayVisible: false
        }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      expect(screen.queryByText('Vim Mode')).not.toBeInTheDocument();
    });

    it('should call onToggleVimMode when vim mode toggle is clicked', async () => {
      const onToggleVimMode = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          isEditorOverlayVisible: true,
          onToggleVimMode
        }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const vimButton = screen.getByLabelText('Toggle vim mode');
      await fireEvent.click(vimButton);

      expect(onToggleVimMode).toHaveBeenCalledTimes(1);
    });

    it('should show active state on vim mode toggle when enabled', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isEditorOverlayVisible: true,
          isVimModeEnabled: true
        }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const vimButton = screen.getByLabelText('Toggle vim mode');
      expect(vimButton.classList.contains('active')).toBe(true);
    });
  });

  describe('Fork Button', () => {
    it('should render fork button in toolbar', () => {
      render(MenuBar, { props: defaultProps });

      const forkButton = screen.getByLabelText('Fork shader');
      expect(forkButton).toBeInTheDocument();
    });

    it('should call onFork when fork button is clicked', async () => {
      const onFork = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          onFork
        }
      });

      const forkButton = screen.getByLabelText('Fork shader');
      await fireEvent.click(forkButton);

      expect(onFork).toHaveBeenCalledOnce();
    });

    it('should show fork option in options menu', async () => {
      render(MenuBar, { props: defaultProps });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      expect(screen.getByText('Fork')).toBeInTheDocument();
    });

    it('should call onFork from options menu and close menu', async () => {
      const onFork = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          onFork
        }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      // Find the fork button in the options menu (second one with Fork shader label)
      const forkButtons = screen.getAllByLabelText('Fork shader');
      await fireEvent.click(forkButtons[forkButtons.length - 1]);

      expect(onFork).toHaveBeenCalledOnce();
      // Menu should be closed
      expect(screen.queryByText('Fork')).not.toBeInTheDocument();
    });
  });

  describe('Time Manager Edge Cases', () => {
    it('should handle null timeManager gracefully', async () => {
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          timeManager: null 
        } 
      });

      // Should show 0.00s for time when no timeManager
      expect(screen.getByText('0.00s')).toBeInTheDocument();
      // Should still show FPS
      expect(screen.getByLabelText('Change FPS limit')).toHaveTextContent('60');
    });

    it('should update time display when timeManager provides values', async () => {
      // Mock timeManager to return different values
      const mockTimeManagerWithValues = {
        getCurrentTime: vi.fn().mockReturnValue(10.5),
        isPaused: vi.fn().mockReturnValue(false),
        getSpeed: vi.fn().mockReturnValue(1.0),
        setSpeed: vi.fn(),
        isLoopEnabled: vi.fn().mockReturnValue(false),
        setLoopEnabled: vi.fn(),
        getLoopDuration: vi.fn().mockReturnValue(60),
        setLoopDuration: vi.fn(),
        setTime: vi.fn()
      };

      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          timeManager: mockTimeManagerWithValues 
        } 
      });

      // Should show the time from timeManager
      expect(screen.getByText('10.50s')).toBeInTheDocument();
      expect(mockTimeManagerWithValues.getCurrentTime).toHaveBeenCalled();
    });
  });

  describe('Fullscreen Edge Cases', () => {
    it('should handle fullscreen without canvas element', async () => {
      const requestFullscreenMock = vi.fn();
      document.documentElement.requestFullscreen = requestFullscreenMock;

      render(MenuBar, {
        props: {
          ...defaultProps,
          canvasElement: null
        }
      });

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      // Click fullscreen
      const fullscreenButton = screen.getByLabelText('Toggle fullscreen');
      await fireEvent.click(fullscreenButton);

      // Should call requestFullscreen on document element when no canvas
      expect(requestFullscreenMock).toHaveBeenCalled();
    });

    it('should handle fullscreen with canvas but no container', async () => {
      // Create canvas without canvas-container parent
      const canvasWithoutContainer = document.createElement('canvas');
      const mockParent = document.createElement('div');
      const requestFullscreenMock = vi.fn();
      mockParent.requestFullscreen = requestFullscreenMock;
      mockParent.appendChild(canvasWithoutContainer);

      render(MenuBar, {
        props: {
          ...defaultProps,
          canvasElement: canvasWithoutContainer
        }
      });

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      // Click fullscreen
      const fullscreenButton = screen.getByLabelText('Toggle fullscreen');
      await fireEvent.click(fullscreenButton);

      // Should call requestFullscreen on canvas parent when no container found
      expect(requestFullscreenMock).toHaveBeenCalled();
    });

    it('should handle fullscreen with canvas-container found', async () => {
      // Create canvas with canvas-container parent
      const canvas = document.createElement('canvas');
      const container = document.createElement('div');
      container.classList.add('canvas-container');
      const requestFullscreenMock = vi.fn();
      container.requestFullscreen = requestFullscreenMock;
      container.appendChild(canvas);

      render(MenuBar, {
        props: {
          ...defaultProps,
          canvasElement: canvas
        }
      });

      // Open options menu
      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      // Click fullscreen
      const fullscreenButton = screen.getByLabelText('Toggle fullscreen');
      await fireEvent.click(fullscreenButton);

      // Should call requestFullscreen on the container when found
      expect(requestFullscreenMock).toHaveBeenCalled();
    });
  });

  // Inspector toggle has been moved to DebugPanel

  describe('Error Tooltip Display', () => {
    it('should not show error class on pause button when no errors', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          errors: []
        }
      });

      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton).not.toHaveClass('error');
    });

    it('should show error class on pause button when errors exist', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          errors: ['Shader compilation failed', 'Line 42: syntax error']
        }
      });

      const pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton).toHaveClass('error');
    });

    it('should display error tooltip when errors exist', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          errors: ['Shader compilation failed']
        }
      });

      const errorTooltip = screen.getByText('Shader compilation failed');
      expect(errorTooltip).toBeInTheDocument();
      expect(errorTooltip).toHaveClass('error-tooltip');
    });

    it('should not display error tooltip when no errors', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          errors: []
        }
      });

      const errorTooltip = screen.queryByText(/error/i);
      expect(errorTooltip).not.toBeInTheDocument();
    });

    it('should display multiple errors joined by newline', () => {
      const errors = ['Error 1: Compilation failed', 'Error 2: Syntax error'];
      render(MenuBar, {
        props: {
          ...defaultProps,
          errors
        }
      });

      // The errors should be displayed in the tooltip
      const errorTooltip = screen.getByText((content, element) => {
        if (!element) return false;
        return element.classList.contains('error-tooltip') &&
               content.includes('Error 1') &&
               content.includes('Error 2');
      });
      expect(errorTooltip).toBeInTheDocument();
    });

    it('should update error display when errors prop changes', async () => {
      const { rerender } = render(MenuBar, {
        props: {
          ...defaultProps,
          errors: []
        }
      });

      let pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton).not.toHaveClass('error');

      // Update with errors
      await rerender({
        ...defaultProps,
        errors: ['New error']
      });

      pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton).toHaveClass('error');
      expect(screen.getByText('New error')).toBeInTheDocument();
    });

    it('should remove error display when errors are cleared', async () => {
      const { rerender } = render(MenuBar, {
        props: {
          ...defaultProps,
          errors: ['Some error']
        }
      });

      let pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton).toHaveClass('error');
      expect(screen.getByText('Some error')).toBeInTheDocument();

      // Clear errors
      await rerender({
        ...defaultProps,
        errors: []
      });

      pauseButton = screen.getByLabelText('Toggle pause');
      expect(pauseButton).not.toHaveClass('error');
      expect(screen.queryByText('Some error')).not.toBeInTheDocument();
    });

    it('should wrap pause button in container for tooltip positioning', () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          errors: ['Test error']
        }
      });

      const pauseButton = screen.getByLabelText('Toggle pause');
      const container = pauseButton.parentElement;
      expect(container).toHaveClass('pause-button-container');
    });

    it('should still call onTogglePause when pause button with error is clicked', async () => {
      const onTogglePause = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          errors: ['Error message'],
          onTogglePause
        }
      });

      const pauseButton = screen.getByLabelText('Toggle pause');
      await fireEvent.click(pauseButton);

      expect(onTogglePause).toHaveBeenCalledOnce();
    });
  });

  describe('No Shader Disabled State', () => {
    it('should disable reset button when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Reset shader')).toBeDisabled();
    });

    it('should enable reset button when hasShader is true', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: true } });
      expect(screen.getByLabelText('Reset shader')).not.toBeDisabled();
    });

    it('should disable play/pause button when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Toggle pause')).toBeDisabled();
    });

    it('should enable play/pause button when hasShader is true', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: true } });
      expect(screen.getByLabelText('Toggle pause')).not.toBeDisabled();
    });

    it('should disable time button when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Time settings')).toBeDisabled();
    });

    it('should enable time button when hasShader is true', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: true } });
      expect(screen.getByLabelText('Time settings')).not.toBeDisabled();
    });

    it('should disable FPS limit button when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Change FPS limit')).toBeDisabled();
    });

    it('should disable resolution button when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Change resolution settings')).toBeDisabled();
    });

    it('should disable editor overlay button when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Toggle editor overlay')).toBeDisabled();
    });

    it('should enable editor overlay button when hasShader is true', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: true } });
      expect(screen.getByLabelText('Toggle editor overlay')).not.toBeDisabled();
    });

    it('should disable fork button when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Fork shader')).toBeDisabled();
    });

    it('should enable fork button when hasShader is true', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: true } });
      expect(screen.getByLabelText('Fork shader')).not.toBeDisabled();
    });

    it('should disable lock button when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Toggle lock')).toBeDisabled();
    });

    it('should enable lock button when hasShader is true', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: true } });
      expect(screen.getByLabelText('Toggle lock')).not.toBeDisabled();
    });

    it('should keep options menu button enabled when hasShader is false', () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });
      expect(screen.getByLabelText('Open options menu')).not.toBeDisabled();
    });

    it('should disable shader-affecting options menu items when hasShader is false', async () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      // Shader-affecting items should be disabled
      const editorButtons = screen.getAllByLabelText('Toggle editor overlay');
      expect(editorButtons[editorButtons.length - 1]).toBeDisabled();

      const forkButtons = screen.getAllByLabelText('Fork shader');
      expect(forkButtons[forkButtons.length - 1]).toBeDisabled();

      const lockButtons = screen.getAllByLabelText('Toggle lock');
      expect(lockButtons[lockButtons.length - 1]).toBeDisabled();

      expect(screen.getByLabelText('Reset layout')).toBeDisabled();
      expect(screen.getByLabelText('Refresh shader')).toBeDisabled();
    });

    it('should keep New Shader, Shader Explorer, and Snippet Library enabled when hasShader is false', async () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: false } });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      expect(screen.getByLabelText('New shader')).not.toBeDisabled();
      expect(screen.getByLabelText('Shader explorer')).not.toBeDisabled();
      expect(screen.getByLabelText('Snippet library')).not.toBeDisabled();
    });

    it('should enable shader-affecting options menu items when hasShader is true', async () => {
      render(MenuBar, { props: { ...defaultProps, hasShader: true } });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const editorButtons = screen.getAllByLabelText('Toggle editor overlay');
      expect(editorButtons[editorButtons.length - 1]).not.toBeDisabled();

      const forkButtons = screen.getAllByLabelText('Fork shader');
      expect(forkButtons[forkButtons.length - 1]).not.toBeDisabled();

      const lockButtons = screen.getAllByLabelText('Toggle lock');
      expect(lockButtons[lockButtons.length - 1]).not.toBeDisabled();

      expect(screen.getByLabelText('Reset layout')).not.toBeDisabled();
      expect(screen.getByLabelText('Refresh shader')).not.toBeDisabled();
    });

});

  describe('Extension Command Menu Items', () => {
    it('should call onExtensionCommand with newShader', async () => {
      const onExtensionCommand = vi.fn();
      render(MenuBar, {
        props: { ...defaultProps, onExtensionCommand }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const newShaderButton = screen.getByLabelText('New shader');
      await fireEvent.click(newShaderButton);

      expect(onExtensionCommand).toHaveBeenCalledWith('newShader');
    });

    it('should call onExtensionCommand with openShaderExplorer', async () => {
      const onExtensionCommand = vi.fn();
      render(MenuBar, {
        props: { ...defaultProps, onExtensionCommand }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const explorerButton = screen.getByLabelText('Shader explorer');
      await fireEvent.click(explorerButton);

      expect(onExtensionCommand).toHaveBeenCalledWith('openShaderExplorer');
    });

    it('should call onExtensionCommand with openSnippetLibrary', async () => {
      const onExtensionCommand = vi.fn();
      render(MenuBar, {
        props: { ...defaultProps, onExtensionCommand }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const snippetButton = screen.getByLabelText('Snippet library');
      await fireEvent.click(snippetButton);

      expect(onExtensionCommand).toHaveBeenCalledWith('openSnippetLibrary');
    });

    it('should close options menu after clicking extension command', async () => {
      const onExtensionCommand = vi.fn();
      render(MenuBar, {
        props: { ...defaultProps, onExtensionCommand }
      });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      const newShaderButton = screen.getByLabelText('New shader');
      await fireEvent.click(newShaderButton);

      // Menu should be closed - New shader button should no longer be visible
      expect(screen.queryByLabelText('New shader')).not.toBeInTheDocument();
    });
  });
});
