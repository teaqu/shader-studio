import { beforeEach, describe, expect, it } from 'vitest';
import { clearCubemapPreview, getCubemapPreview, resetCubemapPreviews, setCubemapPreview } from '../../lib/state/cubemapPreview.svelte';

describe('cubemap preview state', () => {
  beforeEach(resetCubemapPreviews);

  it('keeps preview selections separate for every shader and increments refresh', () => {
    setCubemapPreview('/a.glsl', { passName: 'Sky', mode: 'face', face: 'positive-x' });
    setCubemapPreview('/b.glsl', { passName: 'Irradiance', mode: 'environment', face: 'negative-z' });
    setCubemapPreview('/a.glsl', { passName: 'Sky', mode: 'layout', face: 'positive-y' });
    expect(getCubemapPreview('/a.glsl')).toEqual({ passName: 'Sky', mode: 'layout', face: 'positive-y', refresh: 2 });
    expect(getCubemapPreview('/b.glsl')).toEqual({ passName: 'Irradiance', mode: 'environment', face: 'negative-z', refresh: 1 });
  });

  it('clears only the requested shader and supplies an inactive default', () => {
    setCubemapPreview('/a.glsl', { passName: 'Sky', mode: 'face', face: 'positive-x' });
    clearCubemapPreview('/missing.glsl');
    clearCubemapPreview('/a.glsl');
    expect(getCubemapPreview('/a.glsl')).toEqual({ passName: null, mode: 'face', face: 'positive-z', refresh: 2 });
  });

  it('resets every preview', () => {
    setCubemapPreview('/a.glsl', { passName: 'Sky', mode: 'face', face: 'positive-x' });
    resetCubemapPreviews();
    expect(getCubemapPreview('/a.glsl').passName).toBeNull();
  });
});
