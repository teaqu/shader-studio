import { afterEach, describe, expect, it } from 'vitest';
import { getInspectorState, setInspectorState } from '../../lib/state/pixelInspectorState.svelte';
import type { PixelInspectorState } from '../../lib/types/PixelInspectorState';

const emptyState = (): PixelInspectorState => ({
  isEnabled: false, isActive: false, isLocked: false, mouseX: 0, mouseY: 0,
  pixelRGB: null, fragCoord: null, canvasPosition: null, region: null,
});

describe('pixelInspectorState', () => {
  afterEach(() => setInspectorState(emptyState()));

  it('defaults to no captured region', () => {
    expect(getInspectorState().region).toBeNull();
  });

  it('publishes the supplied region object without copying its RGBA bytes', () => {
    const rgba = new Uint8ClampedArray(60 * 60 * 4);
    const state = { ...emptyState(), region: { width: 60, height: 60, rgba } };
    setInspectorState(state);
    expect(getInspectorState().region?.rgba).toBe(rgba);
  });
});
