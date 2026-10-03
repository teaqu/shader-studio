import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LiveInputPreview from '../../../lib/components/config/LiveInputPreview.svelte';
import { drawLiveInputPreview } from '../../../lib/components/config/LiveInputPreview';
import type { AudioVideoController } from '../../../lib/AudioVideoController';

function context() {
  return { canvas: { width: 160, height: 120 }, clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() } as unknown as CanvasRenderingContext2D;
}
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); 
});

describe('live channel previews', () => {
  it('uses ready webcam frames and falls back for pending or ended capture', () => {
    const ctx = context();
    const video = { readyState: 2, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    expect(drawLiveInputPreview(ctx, 'webcam', null)).toBe(false);
    expect(drawLiveInputPreview(ctx, 'webcam', { video: { ...video, readyState: 0 } as HTMLVideoElement })).toBe(false);
    expect(drawLiveInputPreview(ctx, 'webcam', { video })).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 0, 0, 160, 120);
    vi.mocked(ctx.drawImage).mockImplementation(() => {
      throw new Error('ended'); 
    });
    expect(drawLiveInputPreview(ctx, 'webcam', { video })).toBe(false);
  });
  it('draws mic spectrum and waveform, including silent input', () => {
    const ctx = context();
    expect(drawLiveInputPreview(ctx, 'microphone', {})).toBe(false);
    expect(drawLiveInputPreview(ctx, 'microphone', { frequency: new Uint8Array(0), waveform: new Uint8Array(0) })).toBe(false);
    expect(drawLiveInputPreview(ctx, 'microphone', { frequency: new Uint8Array(512), waveform: new Uint8Array(512).fill(128) })).toBe(true);
    expect(ctx.fillRect).toHaveBeenCalledTimes(33);
    expect(ctx.lineTo).toHaveBeenCalledTimes(159);
    expect(ctx.stroke).toHaveBeenCalledOnce();
  });
  it('updates on capture enable/removal and stops polling when unmounted', async () => {
    vi.useFakeTimers();
    const ctx = context();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext);
    const getLiveInputPreview = vi.fn().mockReturnValue(null);
    const controller = { getLiveInputPreview } as unknown as AudioVideoController;
    const { getByLabelText, unmount } = render(LiveInputPreview, { type: 'microphone', audioVideoController: controller });
    await tick();
    expect(getByLabelText('Live microphone preview').classList.contains('active')).toBe(false);
    getLiveInputPreview.mockReturnValue({ frequency: new Uint8Array(512), waveform: new Uint8Array(512).fill(128) });
    await vi.advanceTimersByTimeAsync(100);
    expect(getByLabelText('Live microphone preview').classList.contains('active')).toBe(true);
    getLiveInputPreview.mockReturnValue(null);
    await vi.advanceTimersByTimeAsync(100);
    expect(getByLabelText('Live microphone preview').classList.contains('active')).toBe(false);
    unmount();
    const calls = getLiveInputPreview.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(getLiveInputPreview).toHaveBeenCalledTimes(calls);
  });
  it('keeps fallback without a controller or canvas context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { getByLabelText } = render(LiveInputPreview, { type: 'webcam' });
    await tick();
    expect(getByLabelText('Live webcam preview').classList.contains('active')).toBe(false);
  });
});
