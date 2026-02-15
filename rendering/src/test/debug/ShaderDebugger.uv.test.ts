import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../../debug/ShaderDebugger';

describe('ShaderDebugger - uv.x *= Bug', () => {
  it('should handle uv.x *= iResolution.x / iResolution.y', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = -1. + 2. * fragCoord / iResolution.xy;
  uv.x *= iResolution.x / iResolution.y;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '  uv.x *= iResolution.x / iResolution.y;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('uv');
      expect(result).toContain('vec4(uv');
      expect(result).toContain('uv.x *=');
      expect(result).toContain('}');
      expect(result).toContain('Debug: visualize vec2');
    }
  });

  it('should detect uv variable from previous line', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.x *= 2.0;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '  uv.x *= 2.0;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('uv.x *= 2.0');
      expect(result).toContain('vec4(uv');
    }
  });

  it('should handle color.r *= 0.5', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 color = vec3(1.0);
  color.r *= 0.5;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '  color.r *= 0.5;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('color.r *= 0.5');
      expect(result).toContain('vec4(color');
    }
  });

  it('should handle member access with complex expression', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = -1. + 2. * fragCoord / iResolution.xy;
  uv.x *= iResolution.x / iResolution.y;

  float l = length(uv);
  fragColor = vec4(vec3(l), 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '  uv.x *= iResolution.x / iResolution.y;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('uv.x *=');
      expect(result).not.toContain('float l = length(uv)');
      expect(result).toContain('vec4(uv');
    }
  });
});
