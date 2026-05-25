import { describe, expect, it } from 'vitest';

describe('test setup browser globals', () => {
  it('provides a usable 2d canvas context in jsdom', () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    expect(ctx).toBeTruthy();
    expect(ctx?.putImageData).toEqual(expect.any(Function));
    expect(ctx?.clearRect).toEqual(expect.any(Function));
  });

  it('provides ImageData in jsdom', () => {
    const imageData = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);

    expect(imageData.width).toBe(1);
    expect(imageData.height).toBe(1);
    expect(imageData.data).toHaveLength(4);
  });

  it('provides media element playback stubs in jsdom', async () => {
    const video = document.createElement('video');

    await expect(video.play()).resolves.toBeUndefined();
    expect(() => video.pause()).not.toThrow();
    expect(() => video.load()).not.toThrow();
  });
});
