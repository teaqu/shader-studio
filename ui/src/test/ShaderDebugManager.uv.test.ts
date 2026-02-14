import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - uv.x *= Bug', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
  });

  it('should handle uv.x *= iResolution.x / iResolution.y', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = -1. + 2. * fragCoord / iResolution.xy;
  uv.x *= iResolution.x / iResolution.y;
}`;

    manager.toggleEnabled();
    manager.updateDebugLine(3, '  uv.x *= iResolution.x / iResolution.y;', 'test.glsl');

    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('=== DEBUG OUTPUT ===');
    console.log('Input shader:');
    console.log(shader);
    console.log('\nResult:');
    console.log(result);
    console.log('===================');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('uv');
      expect(result).toContain('vec4(uv');
      expect(result).toContain('uv.x *=');

      // Should close mainImage
      expect(result).toContain('}');

      // Should have debug visualization
      expect(result).toContain('Debug: visualize vec2');
    }
  });

  it('should detect uv variable from previous line', () => {
    const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.x *= 2.0;
}`;

    manager.toggleEnabled();
    manager.updateDebugLine(3, '  uv.x *= 2.0;', 'test.glsl');

    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('=== SIMPLE UV.X TEST ===');
    console.log('Result:');
    console.log(result);
    console.log('========================');

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

    manager.toggleEnabled();
    manager.updateDebugLine(3, '  color.r *= 0.5;', 'test.glsl');

    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('=== COLOR.R TEST ===');
    console.log('Result:');
    console.log(result);
    console.log('====================');

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

    manager.toggleEnabled();
    manager.updateDebugLine(3, '  uv.x *= iResolution.x / iResolution.y;', 'test.glsl');

    const result = manager.modifyShaderForDebugging(shader, 3, 0);

    console.log('=== FULL SHADER TEST ===');
    console.log('Result:');
    console.log(result);
    console.log('========================');

    expect(result).not.toBeNull();
    if (result) {
      // Should truncate at line 3
      expect(result).toContain('uv.x *=');
      expect(result).not.toContain('float l = length(uv)');

      // Should visualize uv
      expect(result).toContain('vec4(uv');
    }
  });
});
