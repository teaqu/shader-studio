import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';
import VrPreviewButton from '../../lib/components/menu/VrPreviewButton.svelte';
import { getVrPreviewState, toggleImmersiveVr, toggleVrPreview, updateVrPreviewContext } from '../../lib/state/vrPreviewState.svelte';

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
    expect(getVrPreviewState()).toMatchObject({ available: true, enabled: true });
    updateVrPreviewContext(renderer, 'b', false);
    expect(getVrPreviewState()).toMatchObject({ available: false, enabled: false });
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


describe('immersive VR controls', () => {
  function headset() {
    const renderer = engine();
    renderer.isImmersiveVrSupported = vi.fn(async () => true);
    renderer.enterVr = vi.fn(async () => {});
    renderer.exitVr = vi.fn(async () => {});
    return renderer;
  }
  it('offers headset entry only for supported mainVR, enters and exits', async () => {
    const renderer = headset();
    updateVrPreviewContext(renderer, 'a');
    const view = render(VrPreviewButton);
    await Promise.resolve();
    const enter = await view.findByRole('button', { name: 'Enter VR' });
    await fireEvent.click(enter);
    expect(renderer.enterVr).toHaveBeenCalled();
    expect(getVrPreviewState().immersive).toBe(true);
    toggleVrPreview();
    expect(getVrPreviewState().enabled).toBe(false);
    await fireEvent.click(view.getByRole('button', { name: 'Exit VR' }));
    expect(getVrPreviewState().immersive).toBe(false);
    updateVrPreviewContext(engine(false), 'b');
    await Promise.resolve();
    expect(getVrPreviewState().supported).toBe(false);
  });
  it('shows permission errors and handles headset-ended sessions', async () => {
    const renderer = headset();
    renderer.enterVr = vi.fn(async () => {
      throw new Error('Permission denied');
    });
    updateVrPreviewContext(renderer, 'a');
    const view = render(VrPreviewButton);
    await Promise.resolve();
    await fireEvent.click(await view.findByRole('button', { name: 'Enter VR' }));
    expect((await view.findByRole('status')).textContent).toBe('Permission denied');
    expect(getVrPreviewState().error).toBe('Permission denied');
    renderer.enterVr = vi.fn(async onEnded => {
      onEnded?.('Tracking lost');
    });
    await toggleImmersiveVr();
    expect(getVrPreviewState().error).toBe('Tracking lost');
    expect(getVrPreviewState().immersive).toBe(false);
  });
  it('ignores stale support probes and ends a startup after changing shaders', async () => {
    const renderer = headset();
    let resolveSupport!: (value: boolean) => void;
    renderer.isImmersiveVrSupported = vi.fn(() => new Promise<boolean>(resolve => {
      resolveSupport = resolve;
    }));
    updateVrPreviewContext(renderer, 'a');
    updateVrPreviewContext(null, '');
    resolveSupport(true);
    await Promise.resolve();
    expect(getVrPreviewState().supported).toBe(false);
    renderer.isImmersiveVrSupported = vi.fn(async () => true);
    let finish!: () => void;
    renderer.enterVr = vi.fn(() => new Promise<void>(resolve => {
      finish = resolve;
    }));
    updateVrPreviewContext(renderer, 'b');
    await Promise.resolve();
    const pending = toggleImmersiveVr();
    expect(getVrPreviewState().busy).toBe(true);
    await toggleImmersiveVr();
    updateVrPreviewContext(null, '');
    finish();
    await pending;
    expect(renderer.exitVr).toHaveBeenCalled();
    expect(getVrPreviewState().immersive).toBe(false);
  });
  it('ignores unsupported browsers and rejected support probes', async () => {
    const renderer = headset();
    renderer.isImmersiveVrSupported = vi.fn(async () => {
      throw new Error('Unavailable');
    });
    updateVrPreviewContext(renderer, 'a');
    await Promise.resolve();
    await toggleImmersiveVr();
    expect(renderer.enterVr).not.toHaveBeenCalled();
    expect(getVrPreviewState().supported).toBe(false);
  });
});
