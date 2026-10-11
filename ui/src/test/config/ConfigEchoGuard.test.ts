import { describe, expect, it } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import { ConfigEchoGuard } from '../../lib/config/ConfigEchoGuard';

const world: ShaderConfig = { version: '1.0', passes: { Image: { geometry: { type: 'vertices' } } } };
const clip: ShaderConfig = { version: '1.0', passes: { Image: { geometry: { type: 'vertices', space: 'clip' } } } };
const blend: ShaderConfig = { version: '1.0', passes: { Image: { ...clip.passes.Image, blend: 'alpha' } } };

describe('configuration echo ordering', () => {
  it('rejects an old world-space echo while clip-space edits await acknowledgement', () => {
    const guard = new ConfigEchoGuard();
    expect(guard.accepts('/shader.glsl', world, 1)).toBe(true);
    guard.recordLocalEdit('/shader.glsl', world, clip);
    guard.recordLocalEdit('/shader.glsl', clip, blend);
    expect(guard.accepts('/shader.glsl', world, 2)).toBe(false);
    expect(guard.accepts('/shader.glsl', clip, 3)).toBe(false);
    expect(guard.accepts('/shader.glsl', blend, 4)).toBe(true);
    expect(guard.accepts('/shader.glsl', world, 2)).toBe(false);
  });

  it('accepts external edits, including reverting after acknowledgement', () => {
    const guard = new ConfigEchoGuard();
    guard.recordLocalEdit('/shader.glsl', world, clip);
    expect(guard.accepts('/shader.glsl', blend, 2)).toBe(true);
    expect(guard.accepts('/shader.glsl', world, 3)).toBe(true);
    expect(guard.accepts('/shader.glsl', world, 3)).toBe(true);
  });

  it('resets pending edits and host sequence when switching shaders', () => {
    const guard = new ConfigEchoGuard();
    guard.accepts('/old.glsl', world, 10);
    guard.recordLocalEdit('/old.glsl', world, clip);
    expect(guard.accepts('/other.glsl', world, 1)).toBe(true);
    guard.recordLocalEdit('/new.glsl', world, clip);
    expect(guard.accepts('/new.glsl', world, 1)).toBe(false);
    expect(guard.accepts('/new.glsl', clip, 2)).toBe(true);
  });

  it('supports legacy hosts without sequence markers and no-op edits', () => {
    const guard = new ConfigEchoGuard();
    guard.recordLocalEdit('/shader.glsl', world, world);
    expect(guard.accepts('/shader.glsl', null)).toBe(true);
    guard.recordLocalEdit('/shader.glsl', null, clip);
    expect(guard.accepts('/shader.glsl', null)).toBe(false);
    expect(guard.accepts('/shader.glsl', clip)).toBe(true);
    expect(guard.accepts('/shader.glsl', world)).toBe(true);
  });

  it('recognizes returning to an earlier local value as the latest pending edit', () => {
    const guard = new ConfigEchoGuard();
    guard.recordLocalEdit('/shader.glsl', world, clip);
    guard.recordLocalEdit('/shader.glsl', clip, world);
    expect(guard.accepts('/shader.glsl', world, 1)).toBe(true);
  });

  it('ignores host resource URI enrichment while matching acknowledgements', () => {
    const guard = new ConfigEchoGuard();
    const resource: ShaderConfig = { version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'texture', path: 'texture.png' } } } } };
    const enriched: ShaderConfig = { version: '1.0', passes: { Image: { inputs: { iChannel0: { type: 'texture', path: 'texture.png', resolved_path: 'vscode-webview://texture.png' } } } } };
    guard.recordLocalEdit('/shader.glsl', world, resource);
    expect(guard.accepts('/shader.glsl', enriched, 2)).toBe(true);
    expect(guard.accepts('/shader.glsl', world, 3)).toBe(true);
  });
});
