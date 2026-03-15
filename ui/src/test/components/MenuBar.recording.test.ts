import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import MenuBar from '../../lib/components/MenuBar.svelte';

describe('MenuBar Recording Integration', () => {
  let defaultProps: any;

  beforeEach(() => {
    defaultProps = {
      timeManager: {
        getCurrentTime: vi.fn(() => 0),
        isPaused: vi.fn(() => false),
        getSpeed: vi.fn(() => 1.0),
        setSpeed: vi.fn(),
        isLoopEnabled: vi.fn(() => false),
        setLoopEnabled: vi.fn(),
        getLoopDuration: vi.fn(() => 60),
        setLoopDuration: vi.fn(),
        setTime: vi.fn(),
      },
      currentFPS: 60,
      canvasWidth: 800,
      canvasHeight: 600,
      hasShader: true,
      isLocked: false,
      errors: [],
      previewVisible: true,
    };
  });

  it('should not show recording menu initially', () => {
    const { container } = render(MenuBar, { props: defaultProps });
    expect(container.querySelector('.recording-menu')).not.toBeInTheDocument();
  });

  it('should show recording menu when camera button is clicked', async () => {
    const { container } = render(MenuBar, { props: defaultProps });
    const cameraButton = container.querySelector('.collapse-record')!;
    expect(cameraButton).toBeInTheDocument();

    await fireEvent.click(cameraButton);

    expect(container.querySelector('.recording-menu')).toBeInTheDocument();
  });

  it('should hide recording menu when camera button is clicked again', async () => {
    const { container } = render(MenuBar, { props: defaultProps });
    const cameraButton = container.querySelector('.collapse-record')!;

    await fireEvent.click(cameraButton);
    expect(container.querySelector('.recording-menu')).toBeInTheDocument();

    await fireEvent.click(cameraButton);
    expect(container.querySelector('.recording-menu')).not.toBeInTheDocument();
  });

  it('camera button should be disabled when hasShader is false', () => {
    const { container } = render(MenuBar, { props: { ...defaultProps, hasShader: false } });
    const cameraButton = container.querySelector('.collapse-record') as HTMLButtonElement;
    expect(cameraButton).toBeDisabled();
  });

  it('should show recording indicator when isRecording is true', () => {
    const { container } = render(MenuBar, { props: { ...defaultProps, isRecording: true } });
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).toBeInTheDocument();
  });

  it('should show Export option in options menu', async () => {
    const { container } = render(MenuBar, { props: defaultProps });
    const optionsButton = container.querySelector('.options-menu-button')!;
    await fireEvent.click(optionsButton);

    expect(screen.getByText('Export')).toBeInTheDocument();
  });

  it('should not show recording indicator when isRecording is false', () => {
    const { container } = render(MenuBar, { props: { ...defaultProps, isRecording: false } });
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).not.toBeInTheDocument();
  });

  it('should pass recording props to RecordingButton', () => {
    const onScreenshot = vi.fn();
    const onRecord = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(MenuBar, {
      props: { ...defaultProps, onScreenshot, onRecord, onCancel, isRecording: true },
    });
    // RecordingButton renders inside MenuBar — verify it received isRecording
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).toBeInTheDocument();
  });

  it('should show all three tabs when recording menu is opened', async () => {
    const { container } = render(MenuBar, { props: defaultProps });
    const cameraButton = container.querySelector('.collapse-record')!;
    await fireEvent.click(cameraButton);

    expect(screen.getByText('Screenshot')).toBeInTheDocument();
    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByText('GIF')).toBeInTheDocument();
  });

  it('should show Capture button on default screenshot tab', async () => {
    const { container } = render(MenuBar, { props: defaultProps });
    const cameraButton = container.querySelector('.collapse-record')!;
    await fireEvent.click(cameraButton);

    expect(screen.getByText('Capture')).toBeInTheDocument();
  });
});
