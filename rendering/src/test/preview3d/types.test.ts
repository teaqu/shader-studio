import { describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW_SETTINGS, createDefaultPreviewSettings } from '../../preview3d/types';

describe('preview 3D settings', () => {
  it('provides 2D defaults that leave existing shaders unchanged', () => {
    expect(DEFAULT_PREVIEW_SETTINGS).toMatchObject({
      mode: '2d',
      mesh: 'cube',
      mapping: { scale: [1, 1], offset: [0, 0], rotation: 0, wrap: 'repeat' },
      object: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      lighting: 'unlit',
      scene: { grid: true, axes: true },
    });
  });

  it('returns independent deeply immutable settings copies for each caller', () => {
    const first = createDefaultPreviewSettings();
    const second = createDefaultPreviewSettings();
    expect(first).not.toBe(second);
    expect(first.mapping).not.toBe(second.mapping);
    expect(Object.isFrozen(first.mapping.scale)).toBe(true);
    expect(DEFAULT_PREVIEW_SETTINGS.mapping.scale).toEqual([1, 1]);
  });
});
