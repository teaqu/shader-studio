import { beforeEach, describe, expect, it } from 'vitest';
import {
  rememberFullscreenDraw,
  resetFullscreenDrawMemory,
  takeFullscreenDraw,
} from '../../lib/state/fullscreenDrawMemory.svelte';

describe('fullscreenDrawMemory', () => {
  beforeEach(() => {
    resetFullscreenDrawMemory();
  });

  it('returns remembered fields once, then forgets them', () => {
    rememberFullscreenDraw('/a.glsl', 'Image', { vertexCount: 6, topology: 'triangle-strip' });

    expect(takeFullscreenDraw('/a.glsl', 'Image')).toEqual({ vertexCount: 6, topology: 'triangle-strip' });
    expect(takeFullscreenDraw('/a.glsl', 'Image')).toBeUndefined();
  });

  it('keys by shader and pass', () => {
    rememberFullscreenDraw('/a.glsl', 'Image', { vertexCount: 6 });
    rememberFullscreenDraw('/a.glsl', 'BufferA', { topology: 'point-list' });

    expect(takeFullscreenDraw('/b.glsl', 'Image')).toBeUndefined();
    expect(takeFullscreenDraw('/a.glsl', 'BufferA')).toEqual({ topology: 'point-list' });
    expect(takeFullscreenDraw('/a.glsl', 'Image')).toEqual({ vertexCount: 6 });
  });

  it('treats a missing shader path as its own key', () => {
    rememberFullscreenDraw(undefined, 'Image', { vertexCount: 3 });

    expect(takeFullscreenDraw('', 'Image')).toEqual({ vertexCount: 3 });
  });

  it('drops undefined fields and forgets an entry when nothing is left to remember', () => {
    rememberFullscreenDraw('/a.glsl', 'Image', { vertexCount: 6, topology: undefined });
    expect(takeFullscreenDraw('/a.glsl', 'Image')).toEqual({ vertexCount: 6 });

    rememberFullscreenDraw('/a.glsl', 'Image', { vertexCount: 6 });
    rememberFullscreenDraw('/a.glsl', 'Image', { vertexCount: undefined, topology: undefined });
    expect(takeFullscreenDraw('/a.glsl', 'Image')).toBeUndefined();
  });

  it('replaces older remembered fields for the same pass', () => {
    rememberFullscreenDraw('/a.glsl', 'Image', { vertexCount: 6 });
    rememberFullscreenDraw('/a.glsl', 'Image', { topology: 'line-list' });

    expect(takeFullscreenDraw('/a.glsl', 'Image')).toEqual({ topology: 'line-list' });
  });

  it('clears everything on reset', () => {
    rememberFullscreenDraw('/a.glsl', 'Image', { vertexCount: 6 });
    resetFullscreenDrawMemory();

    expect(takeFullscreenDraw('/a.glsl', 'Image')).toBeUndefined();
  });
});
