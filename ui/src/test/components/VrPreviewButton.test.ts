import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';
import VrPreviewButton from '../../lib/components/menu/VrPreviewButton.svelte';
import { getVrPreviewState, toggleVrPreview, updateVrPreviewContext } from '../../lib/state/vrPreviewState.svelte';

function engine(available = true): RenderingEngine {
  return { isVrPreviewAvailable: vi.fn(() => available), setVrPreviewEnabled: vi.fn(), render: vi.fn() } as unknown as RenderingEngine;
}

afterEach(() => {
  cleanup();
  updateVrPreviewContext(null, '');
});

describe('VR preview toggle', () => {
  it('is hidden when the engine has no mainVR preview', () => {
    updateVrPreviewContext(engine(false), 'image.glsl');
    const view = render(VrPreviewButton);
    expect(view.queryByRole('button', { name: 'VR preview' })).toBeNull();
    toggleVrPreview();
    expect(getVrPreviewState().enabled).toBe(false);
  });
  it('starts off and explicitly switches on and off', async () => {
    const renderer = engine();
    updateVrPreviewContext(renderer, 'image.glsl');
    const view = render(VrPreviewButton);
    const button = view.getByRole('button', { name: 'VR preview' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(renderer.setVrPreviewEnabled).toHaveBeenLastCalledWith(true);
    expect(renderer.render).toHaveBeenCalled();
    await fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
  it('keeps the displayed VR preview after a failed edit but clears a failed shader switch', () => {
    const renderer = engine();
    updateVrPreviewContext(renderer, 'a');
    toggleVrPreview();
    updateVrPreviewContext(renderer, 'a', false);
    expect(getVrPreviewState()).toEqual({ available: true, enabled: true });
    updateVrPreviewContext(renderer, 'b', false);
    expect(getVrPreviewState()).toEqual({ available: false, enabled: false });
  });
  it('preserves the choice on edits and clears it on shader or engine changes', () => {
    const renderer = engine();
    updateVrPreviewContext(renderer, 'a');
    toggleVrPreview();
    updateVrPreviewContext(renderer, 'a');
    expect(getVrPreviewState().enabled).toBe(true);
    updateVrPreviewContext(renderer, 'b');
    expect(getVrPreviewState().enabled).toBe(false);
    toggleVrPreview();
    updateVrPreviewContext(engine(), 'b');
    expect(getVrPreviewState().enabled).toBe(false);
    updateVrPreviewContext({} as RenderingEngine, 'b');
    expect(getVrPreviewState().available).toBe(false);
  });
});
