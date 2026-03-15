import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import GifTab from '../../../lib/components/recording/GifTab.svelte';

describe('GifTab', () => {
  let defaultProps: any;

  beforeEach(() => {
    defaultProps = {
      canvasWidth: 800,
      canvasHeight: 600,
      currentTime: 5.5,
      onRecord: vi.fn(),
    };
  });

  it('should render Duration section', () => {
    render(GifTab, { props: defaultProps });
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('2\u03c0')).toBeInTheDocument();
    expect(screen.getByText('3s')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText('10s')).toBeInTheDocument();
  });

  it('3s should be active by default', () => {
    render(GifTab, { props: defaultProps });
    const threeSecBtn = screen.getByText('3s');
    expect(threeSecBtn).toHaveClass('active');
  });

  it('should render Start Time section', () => {
    render(GifTab, { props: defaultProps });
    expect(screen.getByText('Start Time')).toBeInTheDocument();
    expect(screen.getByText('5.5s')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('should render Frame Rate presets (10, 15, 24, 30)', () => {
    render(GifTab, { props: defaultProps });
    expect(screen.getByText('Frame Rate')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('15fps should be active by default', () => {
    render(GifTab, { props: defaultProps });
    const fps15Btn = screen.getByText('15');
    expect(fps15Btn).toHaveClass('active');
  });

  it('should render Resolution section with 480p option', () => {
    render(GifTab, { props: defaultProps });
    expect(screen.getByText('Resolution')).toBeInTheDocument();
    expect(screen.getByText('480p')).toBeInTheDocument();
    expect(screen.getByText('720p')).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();
  });

  it('current resolution should be active by default', () => {
    render(GifTab, { props: defaultProps });
    const currentResBtn = screen.getByText('800\u00d7600');
    expect(currentResBtn).toHaveClass('active');
  });

  it('should render Colors section with 32, 64, 128, 256, custom', () => {
    const { container } = render(GifTab, { props: defaultProps });
    expect(screen.getByText('Colors')).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('256')).toBeInTheDocument();
  });

  it('256 should be active by default', () => {
    render(GifTab, { props: defaultProps });
    const colors256Btn = screen.getByText('256');
    expect(colors256Btn).toHaveClass('active');
  });

  it('should render Loop section with Infinite and Once', () => {
    render(GifTab, { props: defaultProps });
    expect(screen.getByText('Loop')).toBeInTheDocument();
    expect(screen.getByText('Infinite')).toBeInTheDocument();
    expect(screen.getByText('Once')).toBeInTheDocument();
  });

  it('Infinite should be active by default', () => {
    render(GifTab, { props: defaultProps });
    const infiniteBtn = screen.getByText('Infinite');
    expect(infiniteBtn).toHaveClass('active');
  });

  it('should render Quality section with 50, 80, 100, custom', () => {
    render(GifTab, { props: defaultProps });
    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('100 should be active by default', () => {
    render(GifTab, { props: defaultProps });
    const quality100Btn = screen.getByText('100');
    expect(quality100Btn).toHaveClass('active');
  });

  it('should show estimated file size', () => {
    const { container } = render(GifTab, { props: defaultProps });
    // Default: 3s * 15fps = 45 frames, 800*600 res
    const infoText = container.querySelector('.recording-info-text');
    expect(infoText).toBeInTheDocument();
    expect(infoText!.textContent).toMatch(/~45 frames/);
    expect(infoText!.textContent).toMatch(/est\. ~/);
  });

  it('should render Record button', () => {
    render(GifTab, { props: defaultProps });
    expect(screen.getByText('Record')).toBeInTheDocument();
  });

  it('should call onRecord with gif format', async () => {
    render(GifTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('Record'));

    expect(defaultProps.onRecord).toHaveBeenCalledTimes(1);
    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.format).toBe('gif');
  });

  it('should call onRecord with correct quality when 80 selected', async () => {
    render(GifTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('80'));
    await fireEvent.click(screen.getByText('Record'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.quality).toBe(80);
  });

  it('should call onRecord with infinite loop (-1) by default', async () => {
    render(GifTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('Record'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.loopCount).toBe(-1);
  });

  it('should call onRecord with once loop (0) when selected', async () => {
    render(GifTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('Once'));
    await fireEvent.click(screen.getByText('Record'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.loopCount).toBe(0);
  });

  it('should call onRecord with custom colors when custom input used', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    // Find the colors custom input by its placeholder
    const colorsInputs = container.querySelectorAll('.recording-custom-fps-input.recording-duration-input');
    // Colors input has placeholder "2-256"
    let colorsInput: HTMLInputElement | null = null;
    colorsInputs.forEach((input) => {
      if ((input as HTMLInputElement).placeholder === '2-256') {
        colorsInput = input as HTMLInputElement;
      }
    });
    expect(colorsInput).not.toBeNull();

    await fireEvent.input(colorsInput!, { target: { value: '64' } });
    await fireEvent.change(colorsInput!, { target: { value: '64' } });
    await fireEvent.click(screen.getByText('Record'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.maxColors).toBe(64);
  });

  it('should clamp colors to valid range on change', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    const colorsInputs = container.querySelectorAll('.recording-custom-fps-input.recording-duration-input');
    let colorsInput: HTMLInputElement | null = null;
    colorsInputs.forEach((input) => {
      if ((input as HTMLInputElement).placeholder === '2-256') {
        colorsInput = input as HTMLInputElement;
      }
    });
    expect(colorsInput).not.toBeNull();

    // Set value above max
    await fireEvent.input(colorsInput!, { target: { value: '500' } });
    await fireEvent.change(colorsInput!, { target: { value: '500' } });

    // The clamped value should be 256
    expect(colorsInput!.value).toBe('256');
  });

  it('should clamp quality to valid range on change', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    const qualityInputs = container.querySelectorAll('.recording-custom-fps-input.recording-duration-input');
    let qualityInput: HTMLInputElement | null = null;
    qualityInputs.forEach((input) => {
      if ((input as HTMLInputElement).placeholder === '1-100') {
        qualityInput = input as HTMLInputElement;
      }
    });
    expect(qualityInput).not.toBeNull();

    // Set value above max
    await fireEvent.input(qualityInput!, { target: { value: '200' } });
    await fireEvent.change(qualityInput!, { target: { value: '200' } });

    // The clamped value should be 100
    expect(qualityInput!.value).toBe('100');
  });

  it('should update estimated file size when settings change', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    const infoText = container.querySelector('.recording-info-text')!;
    const initialText = infoText.textContent;

    // Change duration to 10s -> 10 * 15 = 150 frames
    await fireEvent.click(screen.getByText('10s'));

    const updatedText = infoText.textContent;
    expect(updatedText).not.toBe(initialText);
    expect(updatedText).toMatch(/~150 frames/);
  });

  it('should show custom start time input', () => {
    const { container } = render(GifTab, { props: defaultProps });
    const startTimeInput = container.querySelector('input[step="0.1"]') as HTMLInputElement;
    expect(startTimeInput).toBeInTheDocument();
  });

  it('custom start time input should activate custom mode on focus', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    const startTimeInput = container.querySelector('input[step="0.1"]') as HTMLInputElement;

    await fireEvent.focus(startTimeInput);

    const parentDiv = startTimeInput.closest('.recording-custom-fps');
    expect(parentDiv).toHaveClass('active');
  });

  it('should call onRecord with zero start time when zero mode selected', async () => {
    render(GifTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('0'));
    await fireEvent.click(screen.getByText('Record'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.startTime).toBe(0);
  });

  it('custom duration input should work', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    // GIF duration input has step="0.5"
    const durationInput = container.querySelector('input[step="0.5"]') as HTMLInputElement;
    expect(durationInput).not.toBeNull();

    await fireEvent.input(durationInput, { target: { value: '7' } });
    await fireEvent.click(screen.getByText('Record'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.duration).toBe(7);
  });

  it('custom fps input should work', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    const fpsInput = container.querySelector('input[placeholder="fps"]') as HTMLInputElement;
    expect(fpsInput).not.toBeNull();

    await fireEvent.input(fpsInput, { target: { value: '20' } });
    await fireEvent.click(screen.getByText('Record'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.fps).toBe(20);
  });

  it('should update estimated file size when resolution changes', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    const infoText = container.querySelector('.recording-info-text')!;
    const initialText = infoText.textContent;

    // Switch to 480p (854x480 vs default 800x600)
    await fireEvent.click(screen.getByText('480p'));

    const updatedText = infoText.textContent;
    expect(updatedText).not.toBe(initialText);
    // Same frame count but different estimated size
    expect(updatedText).toMatch(/~45 frames/);
  });

  it('should update estimated file size when fps changes', async () => {
    const { container } = render(GifTab, { props: defaultProps });
    const infoText = container.querySelector('.recording-info-text')!;
    const initialText = infoText.textContent;

    // Change fps to 30: 3s * 30fps = 90 frames
    await fireEvent.click(screen.getByText('30'));

    const updatedText = infoText.textContent;
    expect(updatedText).not.toBe(initialText);
    expect(updatedText).toMatch(/~90 frames/);
  });
});
