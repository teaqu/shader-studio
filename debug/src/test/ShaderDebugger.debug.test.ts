import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Debug Truncation', () => {
  it('should investigate line truncation bug', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = -1. + 2. * fragCoord / iResolution.xy;
  uv.x *= iResolution.x / iResolution.y;
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '  uv.x *= iResolution.x / iResolution.y;');

    expect(result).not.toBeNull();
    if (result) {
      const hasUvDeclaration = result.includes('vec2 uv = -1. + 2. * fragCoord');
      expect(hasUvDeclaration).toBe(true);
    }
  });
});
