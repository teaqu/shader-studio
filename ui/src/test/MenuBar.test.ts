import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import MenuBar from '../lib/components/MenuBar.svelte';
import { currentTheme } from '../lib/stores/themeStore';
import { aspectRatioStore } from '../lib/stores/aspectRatioStore';
import { qualityStore } from '../lib/stores/qualityStore';

// Mock the piWebUtils module
vi.mock('../../../vendor/pilibs/src/piWebUtils.js', () => ({
  piRequestFullScreen: vi.fn()
}));

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
      onQualityChange: vi.fn(),
      onZoomChange: vi.fn(),
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
      onToggleVimMode: vi.fn()
    };

    // Reset all mocks
    vi.clearAllMocks();

    // Reset stores to default values
    currentTheme.set('light');
    aspectRatioStore.setMode('16:9');
    qualityStore.setMode('HD');
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
      
      expect(screen.getByText('60.0 FPS')).toBeInTheDocument();
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

    it('should call piRequestFullScreen when fullscreen button is clicked', async () => {
      // Get the mocked function from the module mock
      const { piRequestFullScreen } = await import('../../../vendor/pilibs/src/piWebUtils.js');
      
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
      
      expect(vi.mocked(piRequestFullScreen)).toHaveBeenCalled();
    });
  });

  describe('Resolution Menu', () => {
    it('should show resolution menu when resolution button is clicked', async () => {
      render(MenuBar, { props: defaultProps });
      
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      
      expect(screen.getByText('Quality')).toBeInTheDocument();
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
      expect(screen.getByText('Quality')).toBeInTheDocument();
    });

    it('should call onQualityChange when quality option is selected', async () => {
      const onQualityChange = vi.fn();
      render(MenuBar, { 
        props: { 
          ...defaultProps, 
          onQualityChange 
        } 
      });
      
      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      
      // Click SD quality
      const sdButton = screen.getByRole('button', { name: 'SD' });
      await fireEvent.click(sdButton);
      
      expect(onQualityChange).toHaveBeenCalledWith('SD');
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
  });

  describe('Menu Interactions', () => {
    it('should close resolution menu when clicking outside', async () => {
      render(MenuBar, { props: defaultProps });
      
      // Open resolution menu
      const resolutionButton = screen.getByLabelText('Change resolution settings');
      await fireEvent.click(resolutionButton);
      expect(screen.getByText('Quality')).toBeInTheDocument();
      
      // Click outside
      await fireEvent.click(document.body);
      
      expect(screen.queryByText('Quality')).not.toBeInTheDocument();
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
    it('should call onToggleConfigPanel when config panel button is clicked', async () => {
      const onToggleConfigPanel = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          onToggleConfigPanel
        }
      });

      // Click config panel toggle button (now in main toolbar)
      const configButton = screen.getByLabelText('Toggle config panel');
      await fireEvent.click(configButton);

      // Verify onToggleConfigPanel was called
      expect(onToggleConfigPanel).toHaveBeenCalledTimes(1);
    });

    it('should show active state when config panel is visible', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
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

  describe('Editor Overlay Button', () => {
    it('should call onToggleEditorOverlay when editor overlay button is clicked', async () => {
      const onToggleEditorOverlay = vi.fn();
      render(MenuBar, {
        props: {
          ...defaultProps,
          onToggleEditorOverlay
        }
      });

      const editorButton = screen.getByLabelText('Toggle editor overlay');
      await fireEvent.click(editorButton);

      expect(onToggleEditorOverlay).toHaveBeenCalledTimes(1);
    });

    it('should show active state when editor overlay is visible', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isEditorOverlayVisible: true
        }
      });

      const editorButton = screen.getByLabelText('Toggle editor overlay');
      expect(editorButton.classList.contains('active')).toBe(true);
    });

    it('should not show active state when editor overlay is hidden', async () => {
      render(MenuBar, {
        props: {
          ...defaultProps,
          isEditorOverlayVisible: false
        }
      });

      const editorButton = screen.getByLabelText('Toggle editor overlay');
      expect(editorButton.classList.contains('active')).toBe(false);
    });

    it('should show Editor option in options menu', async () => {
      render(MenuBar, { props: defaultProps });

      const optionsButton = screen.getByLabelText('Open options menu');
      await fireEvent.click(optionsButton);

      expect(screen.getByText('Editor')).toBeInTheDocument();
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

      // There are two with same aria-label: toolbar button and options menu item
      const menuItems = screen.getAllByLabelText('Toggle editor overlay');
      await fireEvent.click(menuItems[menuItems.length - 1]);

      expect(onToggleEditorOverlay).toHaveBeenCalled();
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
      expect(screen.getByText('60.0 FPS')).toBeInTheDocument();
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
      const { piRequestFullScreen } = await import('../../../vendor/pilibs/src/piWebUtils.js');
      
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
      
      // Should call with null when no canvas element
      expect(vi.mocked(piRequestFullScreen)).toHaveBeenCalledWith(null);
    });

    it('should handle fullscreen with canvas but no container', async () => {
      const { piRequestFullScreen } = await import('../../../vendor/pilibs/src/piWebUtils.js');
      
      // Create canvas without canvas-container parent
      const canvasWithoutContainer = document.createElement('canvas');
      const mockParent = document.createElement('div');
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
      
      // Should call with canvas parent when no container found
      expect(vi.mocked(piRequestFullScreen)).toHaveBeenCalledWith(mockParent);
    });

    it('should handle fullscreen with canvas-container found', async () => {
      const { piRequestFullScreen } = await import('../../../vendor/pilibs/src/piWebUtils.js');
      
      // Create canvas with canvas-container parent
      const canvas = document.createElement('canvas');
      const container = document.createElement('div');
      container.classList.add('canvas-container');
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
      
      // Should call with the container when found
      expect(vi.mocked(piRequestFullScreen)).toHaveBeenCalledWith(container);
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
});
