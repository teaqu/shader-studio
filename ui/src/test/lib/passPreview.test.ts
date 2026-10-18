import { describe, it, expect } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import { canPreviewPass, createPassPreview, getPreviewedPass } from '../../lib/passPreview';

const config: ShaderConfig = { version: '1', passes: { Image: { resolution: { width: 32, height: 24 } }, A: { path: 'a.glsl', inputs: { iChannel0: { type: 'buffer', source: 'A' } } }, common: { path: 'common.glsl' }, Cube: { path: 'cube.glsl', outputKind: 'cubemap' } } };
const request = { config, passName: 'A', language: 'glsl' as const, mode: 'face' as const, face: 'positive-z' as const };
describe('pass preview', () => {
  it('follows the active line-render target without replacing the saved pass selection', () => {
    const selection = { passName: 'A', kind: 'pass' as const, mode: 'face' as const, face: 'positive-z' as const, refresh: 1 };
    const debug = { isEnabled: true, isActive: true, isInlineRenderingEnabled: true, currentLine: 0, activeBufferName: 'Cube' };
    expect(getPreviewedPass(config, selection, debug)).toBe('Cube');
    expect(getPreviewedPass(config, selection, { ...debug, activeBufferName: 'common' })).toBe('Common');
    for (const inactive of [{ isEnabled: false }, { isActive: false }, { isInlineRenderingEnabled: false }, { currentLine: null }]) {
      expect(getPreviewedPass(config, selection, { ...debug, ...inactive })).toBe('A');
    }
    expect(selection.passName).toBe('A');
  });
  it('labels only valid selections and falls back when a cubemap becomes 2D or disappears', () => {
    const selection = { passName: 'A', mode: 'face' as const, face: 'positive-z' as const, refresh: 1 };
    expect(getPreviewedPass(config, selection)).toBe('Image');
    expect(getPreviewedPass(config, { ...selection, kind: 'pass' })).toBe('A');
    expect(getPreviewedPass(config, { ...selection, passName: 'Cube' })).toBe('Cube');
    expect(getPreviewedPass(config, { ...selection, passName: 'missing' })).toBe('Image');
    expect(getPreviewedPass(config, { ...selection, passName: null })).toBe('Image');
    expect(getPreviewedPass(null, { ...selection, passName: 'Image' })).toBe('Image');
  });
  it.each(['glsl', 'slang', 'wgsl'] as const)('displays a %s pass without changing its source config or feedback', language => {
    const original = structuredClone(config);
    const result = createPassPreview({ ...request, language })!;
    expect(result.code).toContain(language === 'glsl' ? 'texture(iChannel0' : language === 'slang' ? 'iChannel0.Sample' : 'iChannel0Sample');
    expect(result.config.passes.A).toBe(config.passes.A);
    expect(result.config.passes.Image).toEqual({ resolution: { width: 32, height: 24 }, inputs: { iChannel0: { type: 'buffer', source: 'A', filter: 'linear', wrap: 'clamp' } } });
    expect(config).toEqual(original);
  });
  it('supports default-sized outputs and cubemaps', () => {
    expect(createPassPreview({ ...request, config: { ...config, passes: { ...config.passes, Image: {} } } })!.config.passes.Image).not.toHaveProperty('resolution');
    expect(createPassPreview({ ...request, passName: 'Cube' })!.code).toContain('faceDirection');
  });
  it('rejects helpers, missing and compute passes; Image restores normal compilation', () => {
    expect(canPreviewPass(null, 'Image')).toBe(true);
    for (const passName of ['Image', 'common', 'missing']) {
      expect(createPassPreview({ ...request, passName })).toBeNull();
    }
    expect(createPassPreview({ ...request, config: null })).toBeNull();
    const computeConfig = { ...config, passes: { ...config.passes, Compute: { type: 'compute', path: 'compute.wgsl' } } } as ShaderConfig;
    expect(canPreviewPass(computeConfig, 'Compute')).toBe(false);
  });
});
