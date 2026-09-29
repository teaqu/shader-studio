import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import VideoTab from '../../../lib/components/recording/VideoTab.svelte';
import { resetCapturePreferences } from '../../../lib/state/capturePreferences.svelte';

describe('VideoTab', () => {
  let defaultProps: any;

  async function selectRenderMode() {
    await fireEvent.click(screen.getByRole('button', { name: 'Render' }));
  }

  beforeEach(() => {
    resetCapturePreferences();
    vi.stubGlobal('MediaRecorder', { isTypeSupported: vi.fn(() => true) });
    defaultProps = {
      canvasWidth: 800,
      canvasHeight: 600,
      currentTime: 5.5,
      displayFrameRate: 75,
      onRecord: vi.fn(),
    };
  });

  it('should render Format section with MP4 and WebM buttons', () => {
    render(VideoTab, { props: defaultProps });
    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByText('MP4')).toBeInTheDocument();
    expect(screen.getByText('WebM')).toBeInTheDocument();
  });

  it('MP4 should be active by default', () => {
    render(VideoTab, { props: defaultProps });
    const mp4Button = screen.getByText('MP4');
    expect(mp4Button).toHaveClass('active');
  });

  it('defaults to live mode and hides render-only controls', () => {
    render(VideoTab, { props: defaultProps });
    expect(screen.getByRole('button', { name: 'Live' })).toHaveClass('active');
    expect(screen.queryByText('Duration')).not.toBeInTheDocument();
    expect(screen.queryByText('Resolution')).not.toBeInTheDocument();
  });

  it('should render Duration presets (2pi, 5s, 10s, 30s, 60s, custom)', async () => {
    const { container } = render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    // 2pi is rendered as the pi character entity
    expect(screen.getByText('2\u03c0')).toBeInTheDocument();
    expect(screen.getByText('5s')).toBeInTheDocument();
    expect(screen.getByText('10s')).toBeInTheDocument();
    expect(screen.getByText('30s')).toBeInTheDocument();
    expect(screen.getByText('60s')).toBeInTheDocument();
  });

  it('5s should be active by default', async () => {
    render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    const fiveSecBtn = screen.getByText('5s');
    expect(fiveSecBtn).toHaveClass('active');
  });

  it('should render Start Time section', async () => {
    render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    expect(screen.getByText('Start recording at:')).toBeInTheDocument();
    expect(screen.getByText('Renders preceding frames before recording begins.')).toBeInTheDocument();
    expect(screen.queryByText('5.5s')).not.toBeInTheDocument();
    // Zero button
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('should render Frame Rate presets (24, 30, 60, custom)', () => {
    render(VideoTab, { props: defaultProps });
    expect(screen.getByText('Frame Rate')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
  });

  it('screen frame rate should be active by default', () => {
    render(VideoTab, { props: defaultProps });
    expect(screen.getByRole('button', { name: 'Screen (75)' })).toHaveClass('active');
  });

  it('should render Resolution presets', async () => {
    render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    expect(screen.getByText('Resolution')).toBeInTheDocument();
    expect(screen.getByText('800\u00d7600')).toBeInTheDocument();
    expect(screen.getByText('720p')).toBeInTheDocument();
    expect(screen.getByText('1080p')).toBeInTheDocument();
    expect(screen.getByText('4K')).toBeInTheDocument();
  });

  it('should render Record button', () => {
    render(VideoTab, { props: defaultProps });
    expect(screen.getByText('Start recording')).toBeInTheDocument();
  });

  it('should start a live MP4 recording by default', async () => {
    render(VideoTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('Start recording'));

    expect(defaultProps.onRecord).toHaveBeenCalledTimes(1);
    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.mode).toBe('live');
    expect(call.format).toBe('mp4');
    expect(call.fps).toBe(75);
    expect(call.width).toBe(800);
    expect(call.height).toBe(600);
  });

  it('snaps the measured Screen rate to a standard rate for Render exports only', async () => {
    render(VideoTab, { props: { ...defaultProps, displayFrameRate: 23 } });
    expect(screen.getByRole('button', { name: 'Screen (23)' })).toHaveClass('active');

    await selectRenderMode();
    expect(screen.getByRole('button', { name: 'Screen (24)' })).toHaveClass('active');
    await fireEvent.click(screen.getByText('Render video'));

    expect(defaultProps.onRecord.mock.calls[0][0]).toMatchObject({ mode: 'render', fps: 24 });
  });

  it('falls back visibly when the saved format cannot be recorded Live on this host', async () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: vi.fn((type: string) => type.startsWith('video/webm')) });
    render(VideoTab, { props: defaultProps });

    expect(screen.getByRole('button', { name: 'MP4' })).toBeDisabled();
    expect(screen.getByText(/MP4 Live recording isn't supported here, so this will record WebM/)).toBeInTheDocument();
    await fireEvent.click(screen.getByText('Start recording'));
    expect(defaultProps.onRecord.mock.calls[0][0]).toMatchObject({ mode: 'live', format: 'webm' });

    await selectRenderMode();
    expect(screen.getByRole('button', { name: 'MP4' })).not.toBeDisabled();
    expect(screen.queryByText(/isn't supported here/)).not.toBeInTheDocument();
  });

  it('disables Live recording when the host has no MediaRecorder', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    render(VideoTab, { props: defaultProps });

    expect(screen.getByText('Start recording')).toBeDisabled();
    expect(screen.getByText(/Live video recording isn't supported here/)).toBeInTheDocument();
  });

  it('should call onRecord with render settings in render mode', async () => {
    render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    await fireEvent.click(screen.getByText('Render video'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.mode).toBe('render');
    expect(call.duration).toBe(5);
    expect(call.startTime).toBe(0);
  });

  it('should call onRecord with webm format when selected', async () => {
    render(VideoTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('WebM'));
    await fireEvent.click(screen.getByText('Start recording'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.format).toBe('webm');
  });

  it('should call onRecord with correct fps when 60 selected', async () => {
    render(VideoTab, { props: defaultProps });
    await fireEvent.click(screen.getByText('60'));
    await fireEvent.click(screen.getByText('Start recording'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.fps).toBe(60);
  });

  it('should call onRecord with correct duration when 10s selected', async () => {
    render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    await fireEvent.click(screen.getByText('10s'));
    await fireEvent.click(screen.getByText('Render video'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.duration).toBe(10);
  });

  it('should call onRecord with 1080p resolution when selected', async () => {
    render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    await fireEvent.click(screen.getByText('1080p'));
    await fireEvent.click(screen.getByText('Render video'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.width).toBe(1920);
    expect(call.height).toBe(1080);
  });

  it('should show custom start time input', async () => {
    const { container } = render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    // The custom start time input has placeholder "s" and step "0.1"
    const startTimeInputs = container.querySelectorAll('input[step="0.1"]');
    expect(startTimeInputs.length).toBeGreaterThanOrEqual(1);
  });

  it('custom start time input should activate custom mode on focus', async () => {
    const { container } = render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    const startTimeInput = container.querySelector('input[step="0.1"]') as HTMLInputElement;
    expect(startTimeInput).not.toBeNull();

    await fireEvent.focus(startTimeInput);

    // The parent div should now have the 'active' class
    const parentDiv = startTimeInput.closest('.recording-custom-fps');
    expect(parentDiv).toHaveClass('active');
  });

  it('should call onRecord with custom start time', async () => {
    const { container } = render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    const startTimeInput = container.querySelector('input[step="0.1"]') as HTMLInputElement;

    await fireEvent.focus(startTimeInput);
    await fireEvent.input(startTimeInput, { target: { value: '3.5' } });
    await fireEvent.click(screen.getByText('Render video'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.startTime).toBe(3.5);
  });

  it('should call onRecord with zero start time when zero mode selected', async () => {
    render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    await fireEvent.click(screen.getByText('0'));
    await fireEvent.click(screen.getByText('Render video'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.startTime).toBe(0);
  });

  it('custom fps input should work', async () => {
    const { container } = render(VideoTab, { props: defaultProps });
    const fpsInput = container.querySelector('input[placeholder="fps"]') as HTMLInputElement;
    expect(fpsInput).not.toBeNull();

    await fireEvent.input(fpsInput, { target: { value: '45' } });
    await fireEvent.click(screen.getByText('Start recording'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.fps).toBe(45);
  });

  it('should call onRecord with custom resolution when custom preset selected', async () => {
    const { container } = render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    // Find the custom resolution width and height inputs
    const resInputs = container.querySelectorAll('.recording-custom-res-input') as NodeListOf<HTMLInputElement>;
    expect(resInputs.length).toBe(2);

    const widthInput = resInputs[0];
    const heightInput = resInputs[1];

    // Focus to activate custom mode
    await fireEvent.focus(widthInput);
    await fireEvent.input(widthInput, { target: { value: '1600' } });
    await fireEvent.input(heightInput, { target: { value: '900' } });
    await fireEvent.click(screen.getByText('Render video'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.width).toBe(1600);
    expect(call.height).toBe(900);
  });

  it('custom duration input should work', async () => {
    const { container } = render(VideoTab, { props: defaultProps });
    await selectRenderMode();
    // The duration custom input has class recording-duration-input and is in the Duration section
    // It's the first recording-duration-input (the start time one has step="0.1")
    const durationInput = container.querySelector('input[step="0.5"]') as HTMLInputElement;
    expect(durationInput).not.toBeNull();

    await fireEvent.input(durationInput, { target: { value: '15' } });
    await fireEvent.click(screen.getByText('Render video'));

    const call = defaultProps.onRecord.mock.calls[0][0];
    expect(call.duration).toBe(15);
  });
});
