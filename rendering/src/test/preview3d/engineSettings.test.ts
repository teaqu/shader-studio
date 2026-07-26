import { describe, expect, it } from 'vitest';
import { RenderingEngine as WebGLRenderingEngine } from '../../webgl/RenderingEngine';
import { WebGPURenderingEngine } from '../../webgpu/WebGPURenderingEngine';
import { createDefaultPreviewSettings, type PreviewSettings } from '../../preview3d/types';

type PreviewSettingsOwner = {
  previewSettings: PreviewSettings | null;
  setPreviewSettings(settings: PreviewSettings): void;
};

function mutableSettings(): PreviewSettings {
  return {
    ...createDefaultPreviewSettings(),
    mapping: { scale: [1, 1], offset: [0, 0], rotation: 0, wrap: 'repeat' },
    object: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    scene: { grid: true, axes: true },
  };
}

describe.each([
  ['WebGL', () => new WebGLRenderingEngine() as unknown as PreviewSettingsOwner],
  ['WebGPU', () => new WebGPURenderingEngine({ scriptUrl: '', wasmUrl: '' }) as unknown as PreviewSettingsOwner],
])('%s preview settings handoff', (_name, createEngine) => {
  it('stores a frozen defensive snapshot', () => {
    const engine = createEngine();
    const settings = mutableSettings();

    engine.setPreviewSettings(settings);
    (settings.mapping.scale as [number, number])[0] = 9;

    expect(engine.previewSettings).not.toBe(settings);
    expect(engine.previewSettings?.mapping.scale).toEqual([1, 1]);
    expect(Object.isFrozen(engine.previewSettings?.mapping.scale)).toBe(true);
  });
});
