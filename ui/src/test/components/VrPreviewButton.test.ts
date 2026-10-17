import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';
import VrPreviewButton from './fixtures/VrPaneHarness.svelte';
import { getVrPreviewState, toggleImmersiveVr, toggleVrPreview, updateVrPreviewContext, getVrNavigationSettings, updateVrNavigationSettings, setVrPanelVisible } from '../../lib/state/vrPreviewState.svelte';

function engine(available = true): RenderingEngine {
  return { isVrPreviewAvailable: vi.fn(() => available), setVrPreviewEnabled: vi.fn(), setVrNavigationSettings: vi.fn(), render: vi.fn() } as unknown as RenderingEngine;
}

afterEach(() => {
  cleanup();
  updateVrPreviewContext(null, '');
  setVrPanelVisible(false);
  updateVrNavigationSettings({ movement: false, turning: 'snap', movementSpeed: 2, snapAngle: 30, turnSpeed: 90 });
});

describe('VR preview toggle', () => {
  it('is hidden when the engine has no mainVR preview', () => {
    updateVrPreviewContext(engine(false), 'image.glsl');
    const view = render(VrPreviewButton);
    expect(view.queryByRole('button', { name: 'VR' })).toBeNull();
    toggleVrPreview();
    expect(getVrPreviewState().enabled).toBe(false);
  });
  it('starts off and explicitly switches on and off', async () => {
    const renderer = engine();
    updateVrPreviewContext(renderer, 'image.glsl');
    const view = render(VrPreviewButton);
    expect(view.queryByRole('region')).toBeNull();
    await fireEvent.click(view.getByRole('button', { name: 'VR' }));
    const button = view.getByRole('switch', { name: 'Desktop preview' }) as HTMLInputElement;
    expect(button.checked).toBe(false);
    await fireEvent.click(button);
    expect(button.checked).toBe(true);
    expect(renderer.setVrPreviewEnabled).toHaveBeenLastCalledWith(true);
    expect(renderer.render).toHaveBeenCalled();
    await fireEvent.click(button);
    expect(button.checked).toBe(false);
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
    await fireEvent.click(view.getByRole('button', { name: 'VR' }));
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
    await fireEvent.click(view.getByRole('button', { name: 'VR' }));
    await Promise.resolve();
    await fireEvent.click(await view.findByRole('button', { name: 'Enter VR' }));
    expect((await view.findByRole('alert')).textContent).toBe('Permission denied');
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

describe('VR pane settings', () => {
  it('keeps a restored pane informative when the current shader has no mainVR', () => {
    updateVrPreviewContext(engine(false), 'ordinary.glsl');
    setVrPanelVisible(true);
    const view = render(VrPreviewButton);
    expect(view.getByText(/Open a fullscreen GLSL shader/)).toBeTruthy();
    expect((view.getByLabelText('Desktop preview') as HTMLInputElement).disabled).toBe(true);
  });
  it('switches camera controls off together while keeping a documentation shortcut', async () => {
    const renderer = engine();
    updateVrPreviewContext(renderer, 'a');
    const view = render(VrPreviewButton);
    await fireEvent.click(view.getByRole('button', { name: 'VR' }));
    const controls = view.getByLabelText('Enable headset navigation') as HTMLInputElement;
    expect(controls.checked).toBe(false);
    await fireEvent.click(controls);
    expect(getVrNavigationSettings()).toMatchObject({ movement: true, turning: 'snap' });
    await fireEvent.click(view.getByRole('button', { name: 'Smooth' }));
    expect(controls.checked).toBe(true);
    await fireEvent.click(controls);
    expect(getVrNavigationSettings()).toMatchObject({ movement: false, turning: 'smooth' });
    expect(renderer.setVrNavigationSettings).toHaveBeenLastCalledWith(expect.objectContaining({ movement: false, turning: 'smooth' }));
    await fireEvent.click(controls);
    expect(getVrNavigationSettings().turning).toBe('smooth');
    expect(view.getByText(/Hold Shift to move faster/)).toBeTruthy();
    expect(view.getByText(/Hold the left trigger to move faster/)).toBeTruthy();
    const help = view.getByRole('link', { name: 'VR documentation' });
    expect(help.getAttribute('href')).toBe('https://teaqu.github.io/shader-studio/docs/features/vr/');
    expect(view.queryByText('Controller shader inputs')).toBeNull();
    expect(view.queryByLabelText('Left stick movement')).toBeNull();
  });
  it('uses compact switches, a live speed slider and only Snap/Smooth turning', async () => {
    updateVrPreviewContext(engine(), 'a');
    const view = render(VrPreviewButton);
    await fireEvent.click(view.getByRole('button', { name: 'VR' }));
    const navigation = view.getByRole('switch', { name: 'Enable headset navigation' });
    const speed = view.getByRole('slider', { name: 'Movement speed (m/s)' }) as HTMLInputElement;
    expect(speed.disabled || speed.closest('fieldset')?.disabled).toBe(true);
    expect(view.getByRole('button', { name: 'Snap' }).getAttribute('aria-pressed')).toBe('true');
    expect(view.queryByRole('button', { name: 'Off' })).toBeNull();
    expect(view.queryByText('Settings remembered')).toBeNull();
    await fireEvent.click(navigation);
    await fireEvent.input(speed, { target: { value: '4.5' } });
    expect(view.getByText('4.5 m/s')).toBeTruthy();
    expect(getVrNavigationSettings().movementSpeed).toBe(4.5);
    await fireEvent.click(view.getByRole('button', { name: 'Smooth' }));
    expect(view.getByRole('button', { name: 'Smooth' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(navigation);
    expect(view.getByText(/Buttons and sticks are free for your shader/)).toBeTruthy();
    expect(getVrNavigationSettings().turning).toBe('smooth');
  });
  it('keeps movement and turning off by default and applies independent controls', async () => {
    const renderer = engine();
    updateVrPreviewContext(renderer, 'a');
    const view = render(VrPreviewButton);
    await fireEvent.click(view.getByRole('button', { name: 'VR' }));
    expect(view.getByText(/Headset unavailable/)).toBeTruthy();
    expect((view.getByLabelText('Enable headset navigation') as HTMLInputElement).checked).toBe(false);
    expect(view.getByRole('button', { name: 'Snap' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(view.getByLabelText('Enable headset navigation'));
    await fireEvent.input(view.getByLabelText('Movement speed (m/s)'), { target: { value: '3' } });
    await fireEvent.click(view.getByRole('button', { name: 'Snap' }));
    await fireEvent.change(view.getByLabelText('Snap angle (degrees)'), { target: { value: '45' } });
    expect(renderer.setVrNavigationSettings).toHaveBeenLastCalledWith({ movement: true, movementSpeed: 3, turning: 'snap', snapAngle: 45, turnSpeed: 90 });
    expect(JSON.parse(localStorage.getItem('shader-studio-vr-navigation-v1')!)).toMatchObject({ movement: true, turning: 'snap' });
    await fireEvent.click(view.getByRole('button', { name: 'Smooth' }));
    await fireEvent.change(view.getByLabelText('Turn speed (degrees/s)'), { target: { value: '120' } });
    expect(getVrNavigationSettings().turnSpeed).toBe(120);
    await fireEvent.click(view.getByRole('button', { name: 'Reset VR settings' }));
    expect(getVrNavigationSettings()).toEqual({ movement: false, movementSpeed: 2, turning: 'snap', snapAngle: 30, turnSpeed: 90 });
    await fireEvent.keyDown(view.getByRole('region'), { key: 'Escape' });
    expect(view.queryByRole('region')).toBeNull();
    await fireEvent.click(view.getByRole('button', { name: 'VR' }));
    expect(view.queryByRole('button', { name: 'Close VR settings' })).toBeNull();
    await fireEvent.click(view.getByRole('button', { name: 'VR' }));
    expect(view.queryByRole('region')).toBeNull();
  });
});
