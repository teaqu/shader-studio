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

  it('should not show recording indicator when isRecording is false', () => {
    const { container } = render(MenuBar, { props: { ...defaultProps, isRecording: false } });
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).not.toBeInTheDocument();
  });

  it('should apply active class to camera button when recording panel is visible', () => {
    const { container } = render(MenuBar, {
      props: { ...defaultProps, isRecordingPanelVisible: true },
    });
    const cameraButton = container.querySelector('.collapse-record');
    expect(cameraButton).toHaveClass('active');
  });

  it('should call onToggleRecordingPanel when camera button is clicked', async () => {
    const onToggleRecordingPanel = vi.fn();
    const { container } = render(MenuBar, { props: { ...defaultProps, onToggleRecordingPanel } });
    const cameraButton = container.querySelector('.collapse-record')!;

    await fireEvent.click(cameraButton);

    expect(onToggleRecordingPanel).toHaveBeenCalledOnce();
  });

  it('should show Export option in options menu when toolbar is narrow', async () => {
    vi.stubGlobal('ResizeObserver', class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.cb = cb; }
      observe(target: Element) {
        this.cb([{ contentRect: { width: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    });
    const { container } = render(MenuBar, { props: defaultProps });
    const optionsButton = container.querySelector('.options-menu-button')!;
    await fireEvent.click(optionsButton);

    expect(screen.getByText('Export')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('should not show Export option in options menu when toolbar is wide', async () => {
    const { container } = render(MenuBar, { props: defaultProps });
    const optionsButton = container.querySelector('.options-menu-button')!;
    await fireEvent.click(optionsButton);

    expect(screen.queryByText('Export')).not.toBeInTheDocument();
  });

  it('should call onToggleRecordingPanel when Export clicked from options menu', async () => {
    const onToggleRecordingPanel = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.cb = cb; }
      observe(target: Element) {
        this.cb([{ contentRect: { width: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    });
    const { container } = render(MenuBar, { props: { ...defaultProps, onToggleRecordingPanel } });
    const optionsButton = container.querySelector('.options-menu-button')!;
    await fireEvent.click(optionsButton);

    const exportButton = screen.getByText('Export');
    await fireEvent.click(exportButton);

    expect(onToggleRecordingPanel).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('should pass isRecording to RecordingButton indicator', () => {
    const { container } = render(MenuBar, {
      props: { ...defaultProps, isRecording: true },
    });
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).toBeInTheDocument();
  });
});
