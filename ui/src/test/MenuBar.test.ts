import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import MenuBar from '../lib/components/MenuBar.svelte';
import { currentTheme } from '../lib/stores/themeStore';
import { aspectRatioStore } from '../lib/stores/aspectRatioStore';
import { qualityStore } from '../lib/stores/qualityStore';

// Mock the piWebUtils module
vi.mock('../../vendor/pilibs/src/piWebUtils.js', () => ({
  piRequestFullScreen: vi.fn()
}));

// Mock the transport factory
vi.mock('../lib/transport/TransportFactory', () => ({
  isVSCodeEnvironment: vi.fn().mockReturnValue(false)
}));

describe('MenuBar Component', () => {
  let mockTimeManager: any;
  let mockCanvas: HTMLCanvasElement;
  
  const defaultProps = {
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
    onZoomChange: vi.fn()
  };

  beforeEach(() => {
    mockTimeManager = {
      getCurrentTime: vi.fn().mockReturnValue(5.25),
      isPaused: vi.fn().mockReturnValue(false)
    };

    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 800;
    mockCanvas.height = 600;

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
      
      expect(screen.getByText('5.25')).toBeInTheDocument();
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
      const { piRequestFullScreen } = await import('../../vendor/pilibs/src/piWebUtils.js');
      
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
});
