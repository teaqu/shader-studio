import { describe, expect, it } from 'vitest';
import type { ShaderConfig } from '@shader-studio/types';
import { isConfiguredNativeRenderRoot } from '../../app/ShaderProjectRoot.js';

const vertex = '@vertex fn vertices() -> @builtin(position) vec4f { return vec4f(); }';
const fragment = '@fragment fn image() -> @location(0) vec4f { return vec4f(); }';

describe('configured native render roots', () => {
  it('requires a sibling config and a native language', () => {
    expect(isConfiguredNativeRenderRoot(`${vertex}\n${fragment}`, 'wgsl', null, false)).toBe(false);
    expect(isConfiguredNativeRenderRoot(`${vertex}\n${fragment}`, 'glsl', null, true)).toBe(false);
  });

  it('routes explicit entry points to project validation even when malformed', () => {
    const config = { version: '1.0', passes: { Image: { entryPoints: null } } } as unknown as ShaderConfig;
    expect(isConfiguredNativeRenderRoot('', 'wgsl', config, true)).toBe(true);
  });

  it('infers exactly one vertex and fragment entry in a sibling-configured source', () => {
    expect(isConfiguredNativeRenderRoot(`${vertex}\n${fragment}`, 'wgsl', null, true)).toBe(true);
    expect(isConfiguredNativeRenderRoot(`${vertex}\n${fragment}`, 'wgsl', { version: '1.0', passes: { Image: {} } }, true)).toBe(true);
    expect(isConfiguredNativeRenderRoot(vertex, 'wgsl', null, true)).toBe(false);
    expect(isConfiguredNativeRenderRoot(fragment, 'wgsl', null, true)).toBe(false);
    expect(isConfiguredNativeRenderRoot(`${vertex}\n${fragment}\n${fragment.replace('image', 'second')}`, 'wgsl', null, true)).toBe(false);
    expect(isConfiguredNativeRenderRoot('@compute @workgroup_size(1) fn update() {}', 'wgsl', null, true)).toBe(false);
  });
});
