import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import '@testing-library/jest-dom';
import type { Writable } from 'svelte/store';
import RecordingPanel from '../../../lib/components/recording/RecordingPanel.svelte';

const makeDefaultState = () => ({
  isRecording: false,
  isFinalizing: false,
  finalizingStartTime: 0,
  progress: 0,
  currentFrame: 0,
  totalFrames: 0,
  format: null as string | null,
  error: null as string | null,
  previewCanvas: null as HTMLCanvasElement | null,
});

// Use globalThis to share the mock store since vi.mock is hoisted
vi.mock('../../../lib/stores/recordingStore', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({
    isRecording: false,
    isFinalizing: false,
    finalizingStartTime: 0,
    progress: 0,
    currentFrame: 0,
    totalFrames: 0,
    format: null,
    error: null,
    previewCanvas: null,
  });
  (globalThis as any).__mockRecordingStore = store;
  return {
    recordingStore: {
      subscribe: store.subscribe,
      startRecording: vi.fn(),
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
    getMockStore().set(makeDefaultState());
    defaultProps = {
      canvasWidth: 800,
      canvasHeight: 600,
      currentTime: 5.5,
      onScreenshot: vi.fn(),
      onRecord: vi.fn(),
      onCancel: vi.fn(),
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

  it('should show ScreenshotTab when screenshot tab active', () => {
    render(RecordingPanel, { props: defaultProps });
    expect(screen.getByText('Capture')).toBeInTheDocument();
  });

  it('should show VideoTab when video tab active', async () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelectorAll('.tab-button');
    await fireEvent.click(tabs[1]);

    expect(screen.getByText('Record')).toBeInTheDocument();
    expect(screen.getByText('MP4')).toBeInTheDocument();
    expect(screen.getByText('WebM')).toBeInTheDocument();
  });

  it('should show GifTab when gif tab active', async () => {
    const { container } = render(RecordingPanel, { props: defaultProps });
    const tabs = container.querySelectorAll('.tab-button');
    await fireEvent.click(tabs[2]);

    expect(screen.getByText('Record')).toBeInTheDocument();
    expect(screen.getByText('Colors')).toBeInTheDocument();
    expect(screen.getByText('Loop')).toBeInTheDocument();
  });

  it('should show determinate progress bar with correct width during recording', () => {
    getMockStore().set({ ...makeDefaultState(), isRecording: true, format: 'webm', totalFrames: 200, currentFrame: 100, progress: 0.5 });

    const { container } = render(RecordingPanel, { props: defaultProps });
    const fill = container.querySelector('.recording-progress-fill:not(.recording-progress-indeterminate)') as HTMLElement;
    expect(fill).toBeInTheDocument();
    expect(fill.style.width).toBe('50%');
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
    // Screenshot tab is default, should show Capture button
    expect(screen.getByText('Capture')).toBeInTheDocument();
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
