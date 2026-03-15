import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import type { Writable } from 'svelte/store';
import RecordingButton from '../../../lib/components/recording/RecordingButton.svelte';

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
  (globalThis as any).__mockRecordingButtonStore = store;
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
  return (globalThis as any).__mockRecordingButtonStore;
}

describe('RecordingButton', () => {
  let defaultProps: any;

  beforeEach(() => {
    getMockStore().set(makeDefaultState());
    defaultProps = {
      canvasWidth: 800,
      canvasHeight: 600,
      currentTime: 0,
      hasShader: true,
      isRecording: false,
      onScreenshot: vi.fn(),
      onRecord: vi.fn(),
      onCancel: vi.fn(),
    };
  });

  it('should render camera button', () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const button = container.querySelector('.collapse-record');
    expect(button).toBeInTheDocument();
    // Should contain the SVG camera icon
    const svg = button!.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('camera button should be disabled when hasShader is false', () => {
    const { container } = render(RecordingButton, { props: { ...defaultProps, hasShader: false } });
    const button = container.querySelector('.collapse-record');
    expect(button).toBeDisabled();
  });

  it('should show recording indicator when isRecording is true', () => {
    const { container } = render(RecordingButton, { props: { ...defaultProps, isRecording: true } });
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).toBeInTheDocument();
  });

  it('should not show recording indicator when isRecording is false', () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const indicator = container.querySelector('.recording-indicator');
    expect(indicator).not.toBeInTheDocument();
  });

  it('should show recording menu when button is clicked', async () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const button = container.querySelector('.collapse-record')!;
    await fireEvent.click(button);

    const menu = container.querySelector('.recording-menu');
    expect(menu).toBeInTheDocument();
  });

  it('should hide recording menu when button is clicked again', async () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const button = container.querySelector('.collapse-record')!;
    await fireEvent.click(button);
    expect(container.querySelector('.recording-menu')).toBeInTheDocument();

    await fireEvent.click(button);
    expect(container.querySelector('.recording-menu')).not.toBeInTheDocument();
  });

  it('toggle() method should toggle menu visibility', async () => {
    const { container, component } = render(RecordingButton, { props: defaultProps });
    expect(container.querySelector('.recording-menu')).not.toBeInTheDocument();

    component.toggle();
    await vi.waitFor(() => {
      expect(container.querySelector('.recording-menu')).toBeInTheDocument();
    });

    component.toggle();
    await vi.waitFor(() => {
      expect(container.querySelector('.recording-menu')).not.toBeInTheDocument();
    });
  });

  it('getIcon() should return camera SVG string', () => {
    const { component } = render(RecordingButton, { props: defaultProps });
    const icon = component.getIcon();
    expect(icon).toContain('<svg');
    expect(icon).toContain('</svg>');
    expect(icon).toContain('viewBox');
  });

  it('should pass props through to RecordingPanel', async () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const button = container.querySelector('.collapse-record')!;
    await fireEvent.click(button);

    // RecordingPanel should be rendered inside the menu with tabs
    const tabs = container.querySelectorAll('.recording-tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent('Screenshot');
    expect(tabs[1]).toHaveTextContent('Video');
    expect(tabs[2]).toHaveTextContent('GIF');
  });

  it('should close menu when toggle() called while open', async () => {
    const { container, component } = render(RecordingButton, { props: defaultProps });

    // Open via click
    const button = container.querySelector('.collapse-record')!;
    await fireEvent.click(button);
    expect(container.querySelector('.recording-menu')).toBeInTheDocument();

    // Close via toggle()
    component.toggle();
    await vi.waitFor(() => {
      expect(container.querySelector('.recording-menu')).not.toBeInTheDocument();
    });
  });

  it('recording menu should contain RecordingPanel with tabs', async () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const btn = container.querySelector('.collapse-record')!;
    await fireEvent.click(btn);

    const menu = container.querySelector('.recording-menu');
    expect(menu).toBeInTheDocument();
    // RecordingPanel renders tabs inside the menu
    const tabs = menu!.querySelector('.recording-tabs');
    expect(tabs).toBeInTheDocument();
  });

  it('recording menu should contain scrollable tab content', async () => {
    const { container } = render(RecordingButton, { props: defaultProps });
    const btn = container.querySelector('.collapse-record')!;
    await fireEvent.click(btn);

    const menu = container.querySelector('.recording-menu');
    const content = menu!.querySelector('.recording-tab-content');
    expect(content).toBeInTheDocument();
  });

  it('isOpen() should return false when menu is closed', () => {
    const { component } = render(RecordingButton, { props: defaultProps });
    expect(component.isOpen()).toBe(false);
  });

  it('isOpen() should return true when menu is open', async () => {
    const { container, component } = render(RecordingButton, { props: defaultProps });
    const btn = container.querySelector('.collapse-record')!;
    await fireEvent.click(btn);
    expect(component.isOpen()).toBe(true);
  });

  it('isOpen() should return false after toggling closed', async () => {
    const { component } = render(RecordingButton, { props: defaultProps });
    component.toggle();
    await vi.waitFor(() => expect(component.isOpen()).toBe(true));
    component.toggle();
    await vi.waitFor(() => expect(component.isOpen()).toBe(false));
  });

  it('showMenu prop should be bindable', async () => {
    const { container } = render(RecordingButton, { props: { ...defaultProps, showMenu: false } });
    expect(container.querySelector('.recording-menu')).not.toBeInTheDocument();
  });
});
