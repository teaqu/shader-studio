import { describe, expect, it } from 'vitest';
import { shaderStarterTemplate } from './index';

describe('shader starter templates', () => {
  it.each(['glsl', 'slang', 'wgsl'] as const)('provides the same animated image example for %s', language => {
    const source = shaderStarterTemplate(language);
    expect(source).toContain('mainImage');
    expect(source).toContain('uv = fragCoord / iResolution.xy;');
    expect(source).toContain('iTime + uv.xyx');
    expect(source).toContain('(0, 2, 4)');
    expect(source.endsWith('}\n')).toBe(true);
  });
  it('uses WGSL shorthand vectors and matches the requested formatting', () => {
    expect(shaderStarterTemplate('wgsl')).toContain('fn mainImage(fragCoord: vec2f) -> vec4f\n{');
    expect(shaderStarterTemplate('wgsl')).toContain('let col = vec3f(0.5) + vec3f(0.5) * cos(iTime + uv.xyx + vec3f(0, 2, 4));');
    expect(shaderStarterTemplate('wgsl')).toContain('return vec4f(col, 1.0);');
  });
});
