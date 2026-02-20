import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../../debug/ShaderDebugger';

describe('ShaderDebugger - spiralSDF Function', () => {
  const shader = `float spiralSDF(vec2 st, float turns) {
    float r = length(st);
    float a = atan(st.x, st.y);
    return step(0.1, sin(r * turns + a));
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = -1. + 2. * fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float l = spiralSDF(uv, 0.5);

    fragColor = vec4(vec3(0) + l, 1.0);
}`;

  it('Line 1: float r inside spiralSDF', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '    float r = length(st);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float r = length(st)');
      expect(result).toContain('return r;');
      expect(result).toContain('spiralSDF(uv, 0.5)');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
    }
  });

  it('Line 2: float a inside spiralSDF', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 2, '    float a = atan(st.x, st.y);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float r = length(st)');
      expect(result).toContain('float a = atan(st.x, st.y)');
      expect(result).toContain('return a;');
      expect(result).toContain('spiralSDF(uv, 0.5)');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('Line 3: return step inside spiralSDF', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 3, '    return step(0.1, sin(r * turns + a));');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float _dbgReturn = step(0.1, sin(r * turns + a))');
      expect(result).toContain('float r = length(st)');
      expect(result).toContain('float a = atan(st.x, st.y)');
      expect(result).toContain('return _dbgReturn;');
      expect(result).toContain('spiralSDF(uv, 0.5)');
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });
});
