import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import '@testing-library/jest-dom';
import type { Writable } from 'svelte/store';
import RecordingPanel from '../../../lib/components/recording/RecordingPanel.svelte';
import { resetCapturePreferences } from '../../../lib/state/capturePreferences.svelte';

const makeDefaultState = () => ({
  phase: 'idle',
  isRecording: false,
  isLive: false,
  isPreparing: false,
  isFinalizing: false,
  finalizingStartTime: 0,
  progress: 0,
  currentFrame: 0,
  totalFrames: 0,
  preparationFrame: 0,
  preparationFrames: 0,
  format: null as string | null,
  error: null as string | null,
  notice: null as string | null,
  previewCanvas: null as HTMLCanvasElement | null,
});

// Use globalThis to share the mock store since vi.mock is hoisted
vi.mock('../../../lib/stores/recordingStore', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({
    phase: 'idle',
    isRecording: false,
    isLive: false,
    isPreparing: false,
    isFinalizing: false,
    finalizingStartTime: 0,
    progress: 0,
    currentFrame: 0,
    totalFrames: 0,
    preparationFrame: 0,
    preparationFrames: 0,
    format: null,
    error: null,
    previewCanvas: null,
  });
  (globalThis as any).__mockRecordingStore = store;
  return {
    recordingStore: {
      subscribe: store.subscribe,
      startRecording: vi.fn(),
      startPreparing: vi.fn(),
      updatePreparation: vi.fn(),
      updateProgress: vi.fn(),
      setFinalizing: vi.fn(),
      setError: vi.fn(),
      setPreviewCanvas: vi.fn(),
      reset: vi.fn(),
      set: store.set,
      _store: store,
    },
  };
});

function getMockStore(): Writable<ReturnType<typeof makeDefaultState>> {
  return (globalThis as any).__mockRecordingStore;
}

describe('RecordingPanel', () => {
  let defaultProps: any;

  beforeEach(() => {
    resetCapturePreferences();
    getMockStore().set(makeDefaultState());
    defaultProps = {
      canvasWidth: 800,
      canvasHeight: 600,
      currentTime: 5.5,
      displayFrameRate: 60,
      onScreenshot: vi.fn(),
      onRecord: vi.fn(),
      onCancel: vi.fn(),
      onStopLive: vi.fn(),
    };
  });

  it('should render three tab buttons (Screenshot, Video, GIF)', () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelectorAll('.tab-button');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent('Screenshot');
    expect(tabs[1]).toHaveTextContent('Video');
    expect(tabs[2]).toHaveTextContent('GIF');
  });

  it('Screenshot tab should be active by default', () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const activeTab = container.querySelector('.tab-button.active');
    expect(activeTab).toHaveTextContent('Screenshot');
  });

  it('should switch to Video tab when clicked', async () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelectorAll('.tab-button');
    await fireEvent.click(tabs[1]);

    const activeTab = container.querySelector('.tab-button.active');
    expect(activeTab).toHaveTextContent('Video');
  });

  it('should switch to GIF tab when clicked', async () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelectorAll('.tab-button');
    await fireEvent.click(tabs[2]);

    const activeTab = container.querySelector('.tab-button.active');
    expect(activeTab).toHaveTextContent('GIF');
  });

  it('tabs should be disabled when recording', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'mp4', totalFrames: 100 });

    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelectorAll('.tab-button');
    tabs.forEach((tab) => {
      expect(tab).toBeDisabled();
    });
  });

  it('should show progress section when recording', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'mp4', totalFrames: 100, currentFrame: 50, progress: 0.5 });

    const { container } = render(RecordingPanel, { props: defaultProps });
    const progressSection = container.querySelector('.recording-progress-section');
    expect(progressSection).toBeInTheDocument();
  });

  it('should show frame progress during recording (not finalizing)', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'mp4', totalFrames: 100, currentFrame: 50, progress: 0.5 });

    render(RecordingPanel, { props: defaultProps });
    expect(screen.getByText('Recording MP4')).toBeInTheDocument();
    expect(screen.getByText('50 / 100 frames (50%)')).toBeInTheDocument();
  });

  it('shows preparation progress separately from encoded frames', () => {
    getMockStore().set({
      ...makeDefaultState(),
      phase: 'preparing',
      isRecording: true,
      isPreparing: true,
      format: 'mp4',
      totalFrames: 50,
      preparationFrame: 10,
      preparationFrames: 20,
      progress: 0.5,
    });

    render(RecordingPanel, { props: defaultProps });
    expect(screen.getByText('Preparing simulation')).toBeInTheDocument();
    expect(screen.getByText('10 / 20 preceding frames (50%)')).toBeInTheDocument();
    expect(screen.queryByText(/encoded frames/)).not.toBeInTheDocument();
  });

  it('should show encoding message during finalization', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, isFinalizing: true, finalizingStartTime: performance.now(), format: 'mp4', totalFrames: 100, currentFrame: 100, progress: 1 });

    render(RecordingPanel, { props: defaultProps });
    expect(screen.getByText('Encoding MP4 (100 frames)...')).toBeInTheDocument();
  });

  it('should show elapsed time during finalization', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, isFinalizing: true, finalizingStartTime: performance.now(), format: 'mp4', totalFrames: 100 });

    render(RecordingPanel, { props: defaultProps });
    expect(screen.getByText('0s elapsed')).toBeInTheDocument();
  });

  it('should show indeterminate progress bar during finalization', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, isFinalizing: true, finalizingStartTime: performance.now(), format: 'mp4', totalFrames: 100 });

    const { container } = render(RecordingPanel, { props: defaultProps });
    const indeterminate = container.querySelector('.recording-progress-indeterminate');
    expect(indeterminate).toBeInTheDocument();
  });

  it('should show cancel button during recording', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'mp4', totalFrames: 100 });

    const { container } = render(RecordingPanel, { props: defaultProps });
    const cancelBtn = container.querySelector('.recording-cancel-btn');
    expect(cancelBtn).toBeInTheDocument();
    expect(cancelBtn).toHaveTextContent('Cancel');
  });

  it('should call onCancel when cancel button clicked', async () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'mp4', totalFrames: 100 });

    const { container } = render(RecordingPanel, { props: defaultProps });
    const cancelBtn = container.querySelector('.recording-cancel-btn')!;
    await fireEvent.click(cancelBtn);

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('groups Discard and Stop & save actions during Live recording', async () => {
    getMockStore().set({
      ...makeDefaultState(),
      phase: 'recording',
      isRecording: true,
      isLive: true,
      format: 'webm',
    });
    render(RecordingPanel, { props: defaultProps });

    await fireEvent.click(screen.getByText('Discard'));
    await fireEvent.click(screen.getByText('Stop & save'));

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
    expect(defaultProps.onStopLive).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.getByText('0s elapsed')).toBeInTheDocument();
    expect(screen.queryByText('0 / 0 frames (0%)')).not.toBeInTheDocument();
    expect(document.querySelector('.recording-progress-indeterminate')).toBeInTheDocument();
  });

  it('should show ScreenshotTab when screenshot tab active', () => {
    render(RecordingPanel, { props: defaultProps });
    expect(screen.getByText('Capture screenshot')).toBeInTheDocument();
  });

  it('should show VideoTab when video tab active', async () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelectorAll('.tab-button');
    await fireEvent.click(tabs[1]);

    expect(screen.getByText('Start recording')).toBeInTheDocument();
    expect(screen.getByText('MP4')).toBeInTheDocument();
    expect(screen.getByText('WebM')).toBeInTheDocument();
  });

  it('should show GifTab when gif tab active', async () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelectorAll('.tab-button');
    await fireEvent.click(tabs[2]);

    expect(screen.getByText('Record')).toBeInTheDocument();
    expect(screen.getByText('Loop')).toBeInTheDocument();
  });

  it('shows a non-cancellable saving state', () => {
    getMockStore().set({ ...makeDefaultState(), phase: 'saving', isRecording: true, format: 'png' });

    render(RecordingPanel, { props: defaultProps });

    expect(screen.getByText('Saving PNG...')).toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.queryByText('Discard')).not.toBeInTheDocument();
  });

  it('shows an informational notice separately from errors', () => {
    getMockStore().set({ ...makeDefaultState(), notice: 'Live recording stopped because a different shader was opened.' });

    render(RecordingPanel, { props: defaultProps });

    expect(screen.getByRole('status')).toHaveTextContent('different shader was opened');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dismisses notices and errors through the recording store', async () => {
    getMockStore().set({ ...makeDefaultState(), notice: 'Saved with a warning.' });
    const { unmount } = render(RecordingPanel, { props: defaultProps });
    await fireEvent.click(screen.getByText('Dismiss'));
    unmount();

    getMockStore().set({ ...makeDefaultState(), error: 'Disk full' });
    render(RecordingPanel, { props: defaultProps });
    await fireEvent.click(screen.getByText('Dismiss'));
    const module = await import('../../../lib/stores/recordingStore');
    expect(module.recordingStore.reset).toHaveBeenCalledTimes(2);
  });

  it('shows capture failures in the panel', () => {
    getMockStore().set({ ...makeDefaultState(), phase: 'error', error: 'Disk full' });

    render(RecordingPanel, { props: defaultProps });

    expect(screen.getByRole('alert')).toHaveTextContent('Disk full');
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('should show determinate progress bar with correct width during recording', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'webm', totalFrames: 200, currentFrame: 100, progress: 0.5 });

    const { container } = render(RecordingPanel, { props: defaultProps });
    const fill = container.querySelector('.recording-progress-fill:not(.recording-progress-indeterminate)') as HTMLElement;
    expect(fill).toBeInTheDocument();
    expect(fill.style.width).toBe('50%');
  });

  it('mirrors a render preview canvas while recording', () => {
    const source = document.createElement('canvas');
    source.width = 640;
    source.height = 360;
    const drawImage = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ drawImage } as never),
    );
    const raf = vi.fn()
      .mockImplementationOnce((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      })
      .mockReturnValue(2);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'webm', previewCanvas: source });

    const { container, unmount } = render(RecordingPanel, { props: defaultProps });

    expect(container.querySelector('.recording-preview-canvas')).toHaveAttribute('width', '640');
    expect(raf).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0);
    unmount();
    getContext.mockRestore();
    vi.unstubAllGlobals();
  });

  it('should not show tab content when recording (only progress)', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'gif', totalFrames: 45 });

    render(RecordingPanel, { props: defaultProps });
    // Tab content tabs (Screenshot/Video/GIF) are visible but Capture/Record buttons from tabs are not
    expect(screen.queryByText('Capture')).not.toBeInTheDocument();
  });

  it('should show cancel button during finalization', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, isFinalizing: true, finalizingStartTime: performance.now(), format: 'gif', totalFrames: 45 });

    const { container } = render(RecordingPanel, { props: defaultProps });
    const cancelBtn = container.querySelector('.recording-cancel-btn');
    expect(cancelBtn).toBeInTheDocument();
    expect(cancelBtn).not.toBeDisabled();
  });

  it('should display format in uppercase in recording header', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'gif', totalFrames: 30 });

    render(RecordingPanel, { props: defaultProps });
    expect(screen.getByText('Recording GIF')).toBeInTheDocument();
  });

  it('should display format in uppercase in finalizing header', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, isFinalizing: true, finalizingStartTime: performance.now(), format: 'webm', totalFrames: 60 });

    render(RecordingPanel, { props: defaultProps });
    expect(screen.getByText('Encoding WEBM (60 frames)...')).toBeInTheDocument();
  });

  it('should show tab content when not recording', () => {
    render(RecordingPanel, { props: defaultProps });
    // Screenshot tab is default, should show the capture action
    expect(screen.getByText('Capture screenshot')).toBeInTheDocument();
    // Progress section should not be shown
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('should preserve tab selection across recording state changes', async () => {
    const { container } = render(RecordingPanel, { props: defaultProps });

    // Switch to GIF tab
    const tabs = container.querySelectorAll('.tab-button');
    await fireEvent.click(tabs[2]);
    expect(container.querySelector('.tab-button.active')).toHaveTextContent('GIF');

    // Simulate recording start and stop
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'gif', totalFrames: 10 });
    await tick();

    getMockStore().set(makeDefaultState());
    await tick();

    // GIF tab should still be active after recording ends
    expect(container.querySelector('.tab-button.active')).toHaveTextContent('GIF');
  });

  it('should render tab content with scrollable class', () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabContent = container.querySelector('.recording-tab-content');
    expect(tabContent).toBeInTheDocument();
  });

  it('should render tabs and content areas as siblings for flex layout', () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelector('.tab-navigation');
    const content = container.querySelector('.recording-tab-content');
    expect(tabs).toBeInTheDocument();
    expect(content).toBeInTheDocument();
    // Both should be direct children of the same parent for flex column layout
    expect(tabs!.parentElement).toBe(content!.parentElement);
  });
});
