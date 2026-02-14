import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import TimeControls from '../../lib/components/TimeControls.svelte';

describe('TimeControls Component', () => {
  let mockTimeManager: any;
  let defaultProps: any;

  beforeEach(() => {
    mockTimeManager = {
      getSpeed: vi.fn(() => 1.0),
      setSpeed: vi.fn(),
      isLoopEnabled: vi.fn(() => false),
      setLoopEnabled: vi.fn(),
      getLoopDuration: vi.fn(() => Math.PI * 2),
      setLoopDuration: vi.fn(),
      setTime: vi.fn(),
      isPaused: vi.fn(() => false),
    };

    defaultProps = {
      timeManager: mockTimeManager,
      currentTime: 3.14,
    };
  });

  describe('Rendering', () => {
    it('should render time display button', () => {
      render(TimeControls, { props: defaultProps });

      expect(screen.getByText('3.14s')).toBeInTheDocument();
    });

    it('should not show menu initially', () => {
      const { container } = render(TimeControls, { props: defaultProps });

      expect(container.querySelector('.time-menu')).not.toBeInTheDocument();
    });

    it('should show menu when time button is clicked', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');

      await fireEvent.click(timeButton);

      expect(container.querySelector('.time-menu')).toBeInTheDocument();
    });

    it('should update time display when currentTime prop changes', async () => {
      const { rerender } = render(TimeControls, { props: defaultProps });

      await rerender({ currentTime: 5.67 });

      expect(screen.getByText('5.67s')).toBeInTheDocument();
    });
  });

  describe('Time Menu Content', () => {
    it('should show Time Range section', async () => {
      render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      expect(screen.getByText('Time Range')).toBeInTheDocument();
    });

    it('should show Speed section', async () => {
      render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      expect(screen.getByText('Speed')).toBeInTheDocument();
    });

    it('should show all duration preset buttons', async () => {
      render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      expect(screen.getByText('2π')).toBeInTheDocument();
      expect(screen.getByText('10s')).toBeInTheDocument();
      expect(screen.getByText('30s')).toBeInTheDocument();
      expect(screen.getByText('1m')).toBeInTheDocument();
      expect(screen.getByText('2m')).toBeInTheDocument();
    });

    it('should show all speed preset buttons', async () => {
      render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      expect(screen.getByText('0.25×')).toBeInTheDocument();
      expect(screen.getByText('0.5×')).toBeInTheDocument();
      expect(screen.getByText('1×')).toBeInTheDocument();
      expect(screen.getByText('2×')).toBeInTheDocument();
      expect(screen.getByText('4×')).toBeInTheDocument();
    });
  });

  describe('Loop Toggle', () => {
    it('should show loop toggle button', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const loopButton = container.querySelector('.loop-toggle-button');
      expect(loopButton).toBeInTheDocument();
    });

    it('should toggle loop when loop button is clicked', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');

      await fireEvent.click(timeButton);

      const loopButton = screen.getByLabelText('Enable loop');
      await fireEvent.click(loopButton);

      expect(mockTimeManager.setLoopEnabled).toHaveBeenCalledWith(true);
    });

    it('should set loop duration when enabling loop', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');

      timeButton.click();
      await tick();

      const loopButton = container.querySelector('.loop-toggle-button') as HTMLElement;
      loopButton.click();
      await tick();

      expect(mockTimeManager.setLoopDuration).toHaveBeenCalledWith(Math.PI * 2);
    });

    it('should have active class when loop is enabled', async () => {
      mockTimeManager.isLoopEnabled.mockReturnValue(true);
      const { container } = render(TimeControls, { props: defaultProps });

      await tick();
      await tick();

      const timeButton = screen.getByText('3.14s');
      timeButton.click();
      await tick();

      const loopButton = container.querySelector('.loop-toggle-button');
      expect(loopButton).toHaveClass('active');
    });
  });

  describe('Duration Presets', () => {
    it('should select 2π duration when clicked', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const preset2Pi = screen.getByText('2π');
      await fireEvent.click(preset2Pi);

      // Should update internal scrubDuration
      const scrubSlider = container.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.max).toBe((Math.PI * 2).toString());
    });

    it('should select 10s duration when clicked', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const preset10s = screen.getByText('10s');
      await fireEvent.click(preset10s);

      const scrubSlider = container.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.max).toBe('10');
    });

    it('should select 2m duration when clicked', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const preset2m = screen.getByText('2m');
      await fireEvent.click(preset2m);

      const scrubSlider = container.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.max).toBe('120');
    });

    it('should update loop duration when preset is changed and loop is enabled', async () => {
      mockTimeManager.isLoopEnabled.mockReturnValue(true);
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');

      timeButton.click();
      await tick();

      // Loop is already enabled from initialization, so just change duration
      const preset30s = screen.getByText('30s');
      preset30s.click();
      await tick();

      expect(mockTimeManager.setLoopDuration).toHaveBeenCalledWith(30);
    });
  });

  describe('Speed Control', () => {
    it('should display current speed', async () => {
      render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      expect(screen.getByText('Speed: 1.00×')).toBeInTheDocument();
    });

    it('should update speed when slider is changed', async () => {
      const user = userEvent.setup();
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await user.click(timeButton);

      const speedSlider = container.querySelector('#speed-slider') as HTMLInputElement;
      // For range inputs, we need to use fireEvent since userEvent doesn't support sliders well
      await fireEvent.input(speedSlider, { target: { value: '2.0' } });

      expect(mockTimeManager.setSpeed).toHaveBeenCalledWith(2.0);
    });

    it('should set speed when preset button is clicked', async () => {
      render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');

      timeButton.click();
      await tick();

      const preset2x = screen.getByText('2×');
      preset2x.click();
      await tick();

      expect(mockTimeManager.setSpeed).toHaveBeenCalledWith(2.0);
    });

    it('should have active class on current speed preset', async () => {
      mockTimeManager.getSpeed.mockReturnValue(0.5);
      render(TimeControls, { props: defaultProps });

      // Wait for onMount
      await tick();
      await tick();

      const timeButton = screen.getByText('3.14s');
      timeButton.click();
      await tick();

      const preset05x = screen.getByText('0.5×');
      expect(preset05x).toHaveClass('active');
    });
  });

  describe('Time Scrubbing', () => {
    it('should render scrub slider', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const scrubSlider = container.querySelector('.time-scrub-slider');
      expect(scrubSlider).toBeInTheDocument();
    });

    it('should set time when scrub slider is dragged', async () => {
      const user = userEvent.setup();
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await user.click(timeButton);

      const scrubSlider = container.querySelector('.time-scrub-slider') as HTMLInputElement;
      // For range inputs, we need to use fireEvent since userEvent doesn't support sliders well
      await fireEvent.input(scrubSlider, { target: { value: '2.5' } });

      expect(mockTimeManager.setTime).toHaveBeenCalledWith(2.5);
    });

    it('should have correct min and max values on scrub slider', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const scrubSlider = container.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.min).toBe('0');
      expect(scrubSlider?.max).toBe((Math.PI * 2).toString());
    });

    it('should update scrub slider max when duration preset changes', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const preset60s = screen.getByText('1m');
      await fireEvent.click(preset60s);

      const scrubSlider = container.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.max).toBe('60');
    });
  });

  describe('Menu Behavior', () => {
    it('should close menu when clicking outside', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      expect(container.querySelector('.time-menu')).toBeInTheDocument();

      // Click outside
      await fireEvent.click(document.body);

      expect(container.querySelector('.time-menu')).not.toBeInTheDocument();
    });

    it('should toggle menu when time button is clicked again', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');

      await fireEvent.click(timeButton);
      expect(container.querySelector('.time-menu')).toBeInTheDocument();

      await fireEvent.click(timeButton);
      expect(container.querySelector('.time-menu')).not.toBeInTheDocument();
    });

    it('should NOT close menu when clicking menu bar buttons', async () => {
      // Render TimeControls within a menu bar context
      const { container } = render(TimeControls, { props: defaultProps });

      // Open the time menu
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);
      expect(container.querySelector('.time-menu')).toBeInTheDocument();

      // Create a mock menu bar button
      const menuBarButton = document.createElement('button');
      menuBarButton.className = 'menu-bar-button';
      const menuBar = document.createElement('div');
      menuBar.className = 'menu-bar';
      menuBar.appendChild(menuBarButton);
      document.body.appendChild(menuBar);

      // Click the menu bar button
      await fireEvent.click(menuBarButton);

      // Menu should still be open
      expect(container.querySelector('.time-menu')).toBeInTheDocument();

      // Cleanup
      document.body.removeChild(menuBar);
    });
  });

  describe('Integration', () => {
    it('should initialize with values from timeManager', async () => {
      mockTimeManager.getSpeed.mockReturnValue(2.0);
      mockTimeManager.isLoopEnabled.mockReturnValue(true);
      mockTimeManager.getLoopDuration.mockReturnValue(30);

      render(TimeControls, { props: defaultProps });

      // Wait for onMount to execute
      await tick();
      await tick();

      expect(mockTimeManager.getSpeed).toHaveBeenCalled();
      expect(mockTimeManager.isLoopEnabled).toHaveBeenCalled();
      expect(mockTimeManager.getLoopDuration).toHaveBeenCalled();
    });

    it('should handle complete workflow: open menu, enable loop, change duration, change speed', async () => {
      const user = userEvent.setup();
      const { container } = render(TimeControls, { props: defaultProps });

      // Open menu
      const timeButton = screen.getByText('3.14s');
      await user.click(timeButton);

      // Enable loop
      const loopButton = container.querySelector('.loop-toggle-button') as HTMLElement;
      await user.click(loopButton);
      expect(mockTimeManager.setLoopEnabled).toHaveBeenCalledWith(true);

      // Change duration
      const preset30s = screen.getByText('30s');
      await user.click(preset30s);
      expect(mockTimeManager.setLoopDuration).toHaveBeenCalledWith(30);

      // Change speed
      const preset2x = screen.getByText('2×');
      await user.click(preset2x);
      expect(mockTimeManager.setSpeed).toHaveBeenCalledWith(2.0);
    });
  });
});
