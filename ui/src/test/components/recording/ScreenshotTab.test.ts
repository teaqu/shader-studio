import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import ScreenshotTab from '../../../lib/components/recording/ScreenshotTab.svelte';
import { resetCapturePreferences } from '../../../lib/state/capturePreferences.svelte';

describe('ScreenshotTab', () => {
  let defaultProps: any;

  async function selectRenderMode() {
    await fireEvent.click(screen.getByRole('button', { name: 'Render' }));
  }

  beforeEach(() => {
    resetCapturePreferences();
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

  it('defaults to live mode and hides render-only controls', () => {
    render(ScreenshotTab, { props: defaultProps });
    expect(screen.getByRole('button', { name: 'Live' })).toHaveClass('active');
    expect(screen.queryByText('Capture frame at:')).not.toBeInTheDocument();
    expect(screen.queryByText('Resolution')).not.toBeInTheDocument();
  });

  it('should render Time section with zero and custom input only', async () => {
    const { container } = render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    expect(screen.getByText('Capture frame at:')).toBeInTheDocument();
    expect(screen.getByText('Renders preceding frames before capturing this frame.')).toBeInTheDocument();
    expect(screen.queryByText('5.5s')).not.toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    // Custom time input
    const customInput = container.querySelector('.recording-duration-input');
    expect(customInput).toBeInTheDocument();
  });

  it('zero should be active by default', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    const zeroBtn = screen.getByText('0');
    expect(zeroBtn).toHaveClass('active');
  });

  it('should switch to zero time mode', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    const zeroBtn = screen.getByText('0');
    await fireEvent.click(zeroBtn);

    expect(zeroBtn).toHaveClass('active');
  });

  it('custom time input should activate custom mode on focus', async () => {
    const { container } = render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    const customInput = container.querySelector('.recording-duration-input') as HTMLInputElement;
    await fireEvent.focus(customInput);

    // The custom container should become active
    const customContainer = customInput.closest('.recording-custom-fps');
    expect(customContainer).toHaveClass('active');
  });

  it('should render Resolution section with presets', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    expect(screen.getByText('Resolution')).toBeInTheDocument();
    expect(screen.getByText('720p')).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();
    expect(screen.getByText('4K')).toBeInTheDocument();
  });

  it('current resolution should be active by default and show canvas dimensions', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    // The \u00d7 is the rendered entity for &times;
    const currentResBtn = screen.getByText('800\u00d7600');
    expect(currentResBtn).toHaveClass('active');
  });

  it('should render Capture button', () => {
    render(ScreenshotTab, { props: defaultProps });
    expect(screen.getByText('Capture screenshot')).toBeInTheDocument();
  });

  it('captures the live canvas by default', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('Capture screenshot'));

    expect(defaultProps.onScreenshot).toHaveBeenCalledTimes(1);
    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.mode).toBe('live');
    expect(call.format).toBe('png');
    expect(call.time).toBeUndefined();
    expect(call.width).toBe(800);
    expect(call.height).toBe(600);
  });

  it('should call onScreenshot with PNG format and zero time in render mode', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    await fireEvent.click(screen.getByText('Capture screenshot'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.mode).toBe('render');
    expect(call.format).toBe('png');
    expect(call.time).toBe(0);
  });

  it('should call onScreenshot with JPEG format', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('JPEG'));
    await fireEvent.click(screen.getByText('Capture screenshot'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.format).toBe('jpeg');
  });

  it('should call onScreenshot with correct resolution when 720p selected', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    await fireEvent.click(screen.getByText('720p'));
    await fireEvent.click(screen.getByText('Capture screenshot'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.width).toBe(1280);
    expect(call.height).toBe(720);
  });

  it('should call onScreenshot with time 0 when zero mode selected', async () => {
    render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    await fireEvent.click(screen.getByText('0'));
    await fireEvent.click(screen.getByText('Capture screenshot'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.time).toBe(0);
  });

  it('should call onScreenshot with custom time when custom mode used', async () => {
    const { container } = render(ScreenshotTab, { props: defaultProps });
    await selectRenderMode();
    const customInput = container.querySelector('.recording-duration-input') as HTMLInputElement;
    await fireEvent.focus(customInput);
    await fireEvent.input(customInput, { target: { value: '3.7' } });
    await fireEvent.click(screen.getByText('Capture screenshot'));

    const call = defaultProps.onScreenshot.mock.calls[0][0];
    expect(call.time).toBe(3.7);
  });
});
