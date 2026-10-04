import { describe, expect, it } from 'vitest';
import {
  getMobilePanel,
  isMobileViewport,
  resetMobileShellState,
  setMobilePanel,
  setMobileViewport,
} from '../state/mobileShellState.svelte';

describe('mobile shell state', () => {
  it('keeps phone navigation separate from the desktop layout and restores Preview by default', () => {
    resetMobileShellState();

    expect(isMobileViewport()).toBe(false);
    expect(getMobilePanel()).toBe('preview');

    setMobileViewport(true);
    setMobilePanel('editor');
    expect(getMobilePanel()).toBe('editor');

    setMobileViewport(false);
    expect(getMobilePanel()).toBe('editor');

    resetMobileShellState();
    expect(getMobilePanel()).toBe('preview');
  });
});
