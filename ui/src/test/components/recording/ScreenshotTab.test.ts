import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import ScreenshotTab from '../../../lib/components/recording/ScreenshotTab.svelte';

describe('ScreenshotTab', () => {
  let defaultProps: any;

  beforeEach(() => {
    defaultProps = {
      canvasWidth: 800,
      canvasHeight: 600,
      currentTime: 5.5,
      onScreenshot: vi.fn(),
    };
  });

  it('should render Format section with PNG and JPEG buttons', () => {
    render(ScreenshotTab, { props: defaultProps });
    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByText('PNG')).toBeInTheDocument();
    expect(screen.getByText('JPEG')).toBeInTheDocument();
  });

  it('PNG should be active by default', () => {
    render(ScreenshotTab, { props: defaultProps });
    const pngButton = screen.getByText('PNG');
    expect(pngButton).toHaveClass('active');
  });

  it('should switch to JPEG when clicked', async () => {
    render(ScreenshotTab, { props: defaultProps });
    const jpegButton = screen.getByText('JPEG');
    await fireEvent.click(jpegButton);

    expect(jpegButton).toHaveClass('active');
    expect(screen.getByText('PNG')).not.toHaveClass('active');
  });

  it('should render Time section with current time, 0, and custom input', () => {
    const { container } = render(ScreenshotTab, { props: defaultProps });
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('5.5s')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    // Custom time input
    const customInput = container.querySelector('.recording-duration-input');
    expect(customInput).toBeInTheDocument();
  });

  it('current time button should be active by default', () => {
    render(ScreenshotTab, { props: defaultProps });
    const currentTimeBtn = screen.getByText('5.5s');
    expect(currentTimeBtn).toHaveClass('active');
  });

  it('should show current time value on button', () => {
    render(ScreenshotTab, { props: { ...defaultProps, currentTime: 12.3 } });
    expect(screen.getByText('12.3s')).toBeInTheDocument();
  });

  it('should switch to zero time mode', async () => {
    render(ScreenshotTab, { props: defaultProps });
    const zeroBtn = screen.getByText('0');
    await fireEvent.click(zeroBtn);

    expect(zeroBtn).toHaveClass('active');
    expect(screen.getByText('5.5s')).not.toHaveClass('active');
  });

  it('custom time input should activate custom mode on focus', async () => {
    const { container } = render(ScreenshotTab, { props: defaultProps });
    const customInput = container.querySelector('.recording-duration-input') as HTMLInputElement;
    await fireEvent.focus(customInput);

    // The custom container should become active
    const customContainer = customInput.closest('.recording-custom-fps');
    expect(customContainer).toHaveClass('active');
  });

  it('should render Resolution section with presets', () => {
    render(ScreenshotTab, { props: defaultProps });
    expect(screen.getByText('Resolution')).toBeInTheDocument();
    expect(screen.getByText('720p')).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();
    expect(screen.getByText('4K')).toBeInTheDocument();
  });

  it('current resolution should be active by default and show canvas dimensions', () => {
    render(ScreenshotTab, { props: defaultProps });
    // The \u00d7 is the rendered entity for &times;
    const currentResBtn = screen.getByText('800\u00d7600');
    expect(currentResBtn).toHaveClass('active');
  });

  it('should render Capture button', () => {
    render(ScreenshotTab, { props: defaultProps });
    expect(screen.getByText('Capture')).toBeInTheDocument();
  });

  it('should call onScreenshot with PNG format and current time', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('Capture'));

    expect(defaultProps.onScreenshot).toHaveBeenCalledTimes(1);
    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.format).toBe('png');
    expect(call.time).toBe(5.5);
    expect(call.width).toBe(800);
    expect(call.height).toBe(600);
  });

  it('should call onScreenshot with JPEG format', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('JPEG'));
    await fireEvent.click(screen.getByText('Capture'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.format).toBe('jpeg');
  });

  it('should call onScreenshot with correct resolution when 720p selected', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('720p'));
    await fireEvent.click(screen.getByText('Capture'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.width).toBe(1280);
    expect(call.height).toBe(720);
  });

  it('should call onScreenshot with time 0 when zero mode selected', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('0'));
    await fireEvent.click(screen.getByText('Capture'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.time).toBe(0);
  });

  it('should call onScreenshot with custom time when custom mode used', async () => {
    const { container } = render(ScreenshotTab, { props: defaultProps });
    const customInput = container.querySelector('.recording-duration-input') as HTMLInputElement;
    await fireEvent.focus(customInput);
    await fireEvent.input(customInput, { target: { value: '3.7' } });
    await fireEvent.click(screen.getByText('Capture'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.time).toBe(3.7);
  });
});
