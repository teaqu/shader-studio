import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - spiralSDF Function', () => {
  const shader = `float spiralSDF(vec2 st, float turns) {
    float r = length(st);
    float a = atan(st.x, st.y);
    return step(0.1, sin(r * turns + a));
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = -1. + 2. * fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float l = spiralSDF(uv, 50.0);

    fragColor = vec4(vec3(0) + l, 1.0);
}`;

  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
  });

  it('Line 1: float r inside spiralSDF', () => {
    manager.updateDebugLine(1, '    float r = length(st);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== LINE 1: float r ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function up to line 1
      expect(result).toContain('float r = length(st)');
      // Should return the debug value (not assign to fragColor inside function!)
      expect(result).toContain('return r;');
      // Should call spiralSDF with actual parameters from mainImage
      expect(result).toContain('spiralSDF(uv, 50.0)');
      // Should visualize in mainImage
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
      // Should execute mainImage up to the call
      expect(result).toContain('vec2 uv = -1. + 2. * fragCoord');
      expect(result).toContain('uv.x *= iResolution.x / iResolution.y');
    }
  });

  it('Line 2: float a inside spiralSDF', () => {
    manager.updateDebugLine(2, '    float a = atan(st.x, st.y);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 2, 0);

    console.log('\n=== LINE 2: float a ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include both r and a
      expect(result).toContain('float r = length(st)');
      expect(result).toContain('float a = atan(st.x, st.y)');
      // Should return the debug value
      expect(result).toContain('return a;');
      // Should call with actual parameters
      expect(result).toContain('spiralSDF(uv, 50.0)');
      // Should visualize in mainImage
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });

  it('Line 3: return step inside spiralSDF', () => {
    manager.updateDebugLine(3, '    return step(0.1, sin(r * turns + a));', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('\n=== LINE 3: return step ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should convert return to variable
      expect(result).toContain('float _dbgReturn = step(0.1, sin(r * turns + a))');
      // Should include r and a declarations
      expect(result).toContain('float r = length(st)');
      expect(result).toContain('float a = atan(st.x, st.y)');
      // Should return the debug value
      expect(result).toContain('return _dbgReturn;');
      // Should call with actual parameters
      expect(result).toContain('spiralSDF(uv, 50.0)');
      // Should visualize in mainImage
      expect(result).toContain('fragColor = vec4(vec3(result), 1.0)');
    }
  });
});
