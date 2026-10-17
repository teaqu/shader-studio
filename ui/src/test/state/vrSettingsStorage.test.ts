import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const key = 'shader-studio-vr-navigation-v1';
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

it('restores navigation independently of the selected shader or engine', async () => {
  localStorage.setItem(key, JSON.stringify({ movement: true, movementSpeed: 3, turning: 'snap', snapAngle: 45, turnSpeed: 120 }));
  const state = await import('../../lib/state/vrPreviewState.svelte');
  const renderer = { setVrNavigationSettings: vi.fn(), render: vi.fn() };
  state.updateVrPreviewContext(renderer, 'a');
  expect(renderer.setVrNavigationSettings).toHaveBeenCalledWith({ movement: true, movementSpeed: 3, turning: 'snap', snapAngle: 45, turnSpeed: 120 });
  state.updateVrPreviewContext(renderer, 'b');
  expect(state.getVrNavigationSettings().snapAngle).toBe(45);
});

it('falls back to disabled navigation for invalid saved JSON', async () => {
  localStorage.setItem(key, '{broken');
  const state = await import('../../lib/state/vrPreviewState.svelte');
  expect(state.getVrNavigationSettings()).toMatchObject({ movement: false, turning: 'off' });
});

it('keeps navigation usable when storage access fails', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const state = await import('../../lib/state/vrPreviewState.svelte');
  state.updateVrNavigationSettings({ movement: true });
  expect(state.getVrNavigationSettings().movement).toBe(true);
});
