import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
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

      expect(document.body.querySelector('.time-menu')).not.toBeInTheDocument();
    });

    it('should show menu when time button is clicked', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');

      await fireEvent.click(timeButton);

      expect(document.body.querySelector('.time-menu')).toBeInTheDocument();
    });

    it('should render the time menu container with both sections when opened', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      await fireEvent.click(screen.getByText('3.14s'));

      const menu = document.body.querySelector('.time-menu');
      expect(menu).toBeInTheDocument();
      expect(menu?.textContent).toContain('Time Range');
      expect(menu?.textContent).toContain('Speed');
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

      const loopButton = document.body.querySelector('.loop-toggle-button');
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

      const loopButton = document.body.querySelector('.loop-toggle-button') as HTMLElement;
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

      const loopButton = document.body.querySelector('.loop-toggle-button');
      expect(loopButton).toHaveClass('active');
    });
  });

  describe('Duration Presets', () => {
    it('should select 2π duration when clicked', async () => {
      mockTimeManager.isLoopEnabled.mockReturnValue(true);
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const preset2Pi = screen.getByText('2π');
      await fireEvent.click(preset2Pi);

      const scrubSlider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.max).toBe((Math.PI * 2).toString());
    });

    it('should select 10s duration when clicked', async () => {
      mockTimeManager.isLoopEnabled.mockReturnValue(true);
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const preset10s = screen.getByText('10s');
      await fireEvent.click(preset10s);

      const scrubSlider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.max).toBe('10');
    });

    it('should select 2m duration when clicked', async () => {
      mockTimeManager.isLoopEnabled.mockReturnValue(true);
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const preset2m = screen.getByText('2m');
      await fireEvent.click(preset2m);

      const scrubSlider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
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

    it('should disable all duration preset buttons when loop is off', async () => {
      mockTimeManager.isLoopEnabled.mockReturnValue(false);
      render(TimeControls, { props: defaultProps });
      await fireEvent.click(screen.getByText('3.14s'));

      const presets = ['2π', '10s', '30s', '1m', '2m'];
      for (const label of presets) {
        expect(screen.getByText(label)).toBeDisabled();
      }
    });

    it('should enable all duration preset buttons when loop is on', async () => {
      mockTimeManager.isLoopEnabled.mockReturnValue(true);
      render(TimeControls, { props: defaultProps });
      await fireEvent.click(screen.getByText('3.14s'));

      const presets = ['2π', '10s', '30s', '1m', '2m'];
      for (const label of presets) {
        expect(screen.getByText(label)).not.toBeDisabled();
      }
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
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const speedSlider = document.body.querySelector('#speed-slider') as HTMLInputElement;
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

      const scrubSlider = document.body.querySelector('.time-scrub-slider');
      expect(scrubSlider).toBeInTheDocument();
    });

    it('should set time when scrub slider is dragged', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const scrubSlider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      // For range inputs, we need to use fireEvent since userEvent doesn't support sliders well
      await fireEvent.input(scrubSlider, { target: { value: '2.5' } });

      expect(mockTimeManager.setTime).toHaveBeenCalledWith(2.5);
    });

    it('should have correct min and max values on scrub slider', async () => {
      // Loop disabled, currentTime = 3.14 → max = Math.max(60, 3.14) = 60
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const scrubSlider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.min).toBe('0');
      expect(scrubSlider?.max).toBe('60');
    });

    it('should update scrub slider max when duration preset changes', async () => {
      mockTimeManager.isLoopEnabled.mockReturnValue(true);
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      const preset60s = screen.getByText('1m');
      await fireEvent.click(preset60s);

      const scrubSlider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(scrubSlider?.max).toBe('60');
    });
  });

  describe('Non-Loop Slider Behavior', () => {
    it('should use Math.max(60, currentTime) as slider max when loop is disabled', async () => {
      // currentTime = 3.14, loop disabled → max should be 60 (the floor)
      const { container } = render(TimeControls, { props: defaultProps });
      await fireEvent.click(screen.getByText('3.14s'));

      const slider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(slider.max).toBe('60');
    });

    it('should use currentTime as slider max when loop is disabled and currentTime > 60', async () => {
      const props = { timeManager: mockTimeManager, currentTime: 90 };
      const { container } = render(TimeControls, { props });
      await fireEvent.click(screen.getByText('90.00s'));

      const slider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(slider.max).toBe('90');
    });

    it('should set slider value to currentTime (no modulo) when loop is disabled', async () => {
      // Use a time larger than the old default loop duration to prove no wrap
      const props = { timeManager: mockTimeManager, currentTime: 75 };
      const { container } = render(TimeControls, { props });
      await fireEvent.click(screen.getByText('75.00s'));

      const slider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(slider.value).toBe('75');
    });

    it('should freeze slider max at scrub start and not grow during scrub', async () => {
      const props = { timeManager: mockTimeManager, currentTime: 90 };
      const { container, rerender } = render(TimeControls, { props });
      await fireEvent.click(screen.getByText('90.00s'));

      const slider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;

      // Start scrubbing — max freezes at Math.max(60, 90) = 90
      await fireEvent.mouseDown(slider);

      // Simulate time advancing during scrub
      await rerender({ currentTime: 95 });
      await tick();

      // Max should still be frozen at 90 (the value when scrub started)
      expect(slider.max).toBe('90');
    });

    it('should unfreeze slider max after scrub ends', async () => {
      const props = { timeManager: mockTimeManager, currentTime: 90 };
      const { container, rerender } = render(TimeControls, { props });
      await fireEvent.click(screen.getByText('90.00s'));

      const slider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;

      await fireEvent.mouseDown(slider);
      await fireEvent.mouseUp(slider);

      // After scrub ends, simulate new currentTime post-scrub (scrubbed back to 45s)
      await rerender({ currentTime: 45 });
      await tick();

      // High-water mark was 90 at scrub start — scrubbing back to 45s doesn't shrink it
      expect(slider.max).toBe('90');
    });

    it('should preserve high-water mark after scrubbing back', async () => {
      // Start at 90s — high-water mark = 90
      const props = { timeManager: mockTimeManager, currentTime: 90 };
      const { container, rerender } = render(TimeControls, { props });
      await fireEvent.click(screen.getByText('90.00s'));

      const slider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;

      // Scrub back to 30s
      await fireEvent.mouseDown(slider);
      await fireEvent.mouseUp(slider);
      await rerender({ currentTime: 30 });
      await tick();

      // Max should still be 90 (high-water mark), not reset to Math.max(60, 30) = 60
      expect(slider.max).toBe('90');
    });

    it('should cap range max at 300s (5 minutes)', async () => {
      const props = { timeManager: mockTimeManager, currentTime: 350 };
      const { container } = render(TimeControls, { props });
      await fireEvent.click(screen.getByText('350.00s'));

      const slider = document.body.querySelector('.time-scrub-slider') as HTMLInputElement;
      expect(slider.max).toBe('300');
    });
  });

  describe('Menu Behavior', () => {
    it('should close menu when clicking outside', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      expect(document.body.querySelector('.time-menu')).toBeInTheDocument();

      // Click outside
      await fireEvent.click(document.body);

      expect(document.body.querySelector('.time-menu')).not.toBeInTheDocument();
    });

    it('should toggle menu when time button is clicked again', async () => {
      const { container } = render(TimeControls, { props: defaultProps });
      const timeButton = screen.getByText('3.14s');

      await fireEvent.click(timeButton);
      expect(document.body.querySelector('.time-menu')).toBeInTheDocument();

      await fireEvent.click(timeButton);
      expect(document.body.querySelector('.time-menu')).not.toBeInTheDocument();
    });

    it('should close menu when clicking outside the trigger and menu', async () => {
      render(TimeControls, { props: defaultProps });

      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);
      expect(document.body.querySelector('.time-menu')).toBeInTheDocument();

      const outsideButton = document.createElement('button');
      document.body.appendChild(outsideButton);

      await fireEvent.click(outsideButton);
      expect(document.body.querySelector('.time-menu')).not.toBeInTheDocument();

      document.body.removeChild(outsideButton);
    });
  });

  describe('Disabled State', () => {
    it('should disable time button when disabled prop is true', () => {
      render(TimeControls, { props: { ...defaultProps, disabled: true } });

      const timeButton = screen.getByLabelText('Time settings');
      expect(timeButton).toBeDisabled();
    });

    it('should enable time button when disabled prop is false', () => {
      render(TimeControls, { props: { ...defaultProps, disabled: false } });

      const timeButton = screen.getByLabelText('Time settings');
      expect(timeButton).not.toBeDisabled();
    });

    it('should enable time button by default when disabled prop is omitted', () => {
      render(TimeControls, { props: defaultProps });

      const timeButton = screen.getByLabelText('Time settings');
      expect(timeButton).not.toBeDisabled();
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
      const { container } = render(TimeControls, { props: defaultProps });

      // Open menu
      const timeButton = screen.getByText('3.14s');
      await fireEvent.click(timeButton);

      // Enable loop
      const loopButton = document.body.querySelector('.loop-toggle-button') as HTMLElement;
      await fireEvent.click(loopButton);
      expect(mockTimeManager.setLoopEnabled).toHaveBeenCalledWith(true);

      // Change duration
      const preset30s = screen.getByText('30s');
      await fireEvent.click(preset30s);
      expect(mockTimeManager.setLoopDuration).toHaveBeenCalledWith(30);

      // Change speed
      const preset2x = screen.getByText('2×');
      await fireEvent.click(preset2x);
      expect(mockTimeManager.setSpeed).toHaveBeenCalledWith(2.0);
    });
  });
});
