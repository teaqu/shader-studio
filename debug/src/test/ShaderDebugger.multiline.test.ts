import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Multi-line UV reassignment', () => {
  it('should detect plain reassignment on line 3', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord/iResolution.xy;
  uv = fragCoord/iResolution.xy * 2.0 - 1.0;
  uv.y += 0.9;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '  uv = fragCoord/iResolution.xy * 2.0 - 1.0;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
      expect(result).toContain('uv = fragCoord/iResolution.xy * 2.0 - 1.0');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('should detect member access on line 4', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord/iResolution.xy;
  uv = fragCoord/iResolution.xy * 2.0 - 1.0;
  uv.y += 0.9;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 4, '  uv.y += 0.9;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
      expect(result).toContain('uv = fragCoord/iResolution.xy * 2.0 - 1.0');
      expect(result).toContain('uv.y += 0.9');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });
});
