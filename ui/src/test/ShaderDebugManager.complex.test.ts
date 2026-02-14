import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - Complex Shader', () => {
  const shader = `vec3 rainCol = vec3(0.5608, 0.4078, 0.9843);
vec3 skyCol = vec3(0.0, 0.3686, 1.0);

float random(vec2 uv) {
  return fract(sin(uv.x * 1920. + uv.y * 3092.) * 4039.);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = fragCoord/iResolution.xy;
    uv = fragCoord/iResolution.xy * 2.0 - 1.0;
    uv.y += 0.9;

    uv *= 1.0;
    float wave = sin(uv.x * 90.0) * 0.004 * sin(uv.y + iTime * 30.);
    vec3 col;
    if (uv.y > wave) {
      uv /= 3.0;
      float rain = sin(uv.y * 4. + iTime * 9.0 * random(uv.xx));
      rainCol *= step(uv.y, rain);
      col = mix(rainCol * rain, skyCol, 0.6);
    } else {
      col = mix(rainCol, skyCol, 0.6);
    }
    fragColor = vec4(col, 1.0);
}`;

  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager(); // Create fresh manager for each test
    manager.toggleEnabled(); // Enable debug mode
  });

  it('Line 0: global vec3 rainCol', () => {
    manager.updateDebugLine(0, 'vec3 rainCol = vec3(0.5608, 0.4078, 0.9843);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 0, 0);

    console.log('\n=== LINE 0: global rainCol ===');
    console.log('Result:', result);

    // Expect one-liner wrapper since it's outside any function
    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 rainCol = vec3(0.5608, 0.4078, 0.9843)');
      expect(result).toContain('fragColor = vec4(rainCol, 1.0)');
    }
  });

  it('Line 1: global vec3 skyCol', () => {
    manager.updateDebugLine(1, 'vec3 skyCol = vec3(0.0, 0.3686, 1.0);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== LINE 1: global skyCol ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 skyCol = vec3(0.0, 0.3686, 1.0)');
      expect(result).toContain('fragColor = vec4(skyCol, 1.0)');
    }
  });

  it('Line 4: return in random() function', () => {
    manager.updateDebugLine(4, '  return fract(sin(uv.x * 1920. + uv.y * 3092.) * 4039.);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 4, 0);

    console.log('\n=== LINE 4: return in random() ===');
    console.log('Result:', result);

    // Verify helper function debugging works
    expect(result).not.toBeNull();
    if (result) {
      // Should convert return to variable assignment
      expect(result).toContain('float _dbgReturn = fract(sin(uv.x * 1920.');
      // Should call random() with actual parameter from mainImage
      expect(result).toContain('random(uv.xx)');
      // Should execute mainImage up to the call point
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
    }
  });

  it('Line 9: vec2 uv declaration in mainImage', () => {
    manager.updateDebugLine(9, '    vec2 uv = fragCoord/iResolution.xy;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 9, 0);

    console.log('\n=== LINE 9: vec2 uv ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('Line 10: uv reassignment in mainImage', () => {
    manager.updateDebugLine(10, '    uv = fragCoord/iResolution.xy * 2.0 - 1.0;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 10, 0);

    console.log('\n=== LINE 10: uv reassignment ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
      expect(result).toContain('uv = fragCoord/iResolution.xy * 2.0 - 1.0');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('Line 11: uv.y += in mainImage', () => {
    manager.updateDebugLine(11, '    uv.y += 0.9;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 11, 0);

    console.log('\n=== LINE 11: uv.y += ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('uv.y += 0.9');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('Line 13: uv *= in mainImage', () => {
    manager.updateDebugLine(13, '    uv *= 1.0;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 13, 0);

    console.log('\n=== LINE 13: uv *= ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('uv *= 1.0');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('Line 14: float wave declaration', () => {
    manager.updateDebugLine(14, '    float wave = sin(uv.x * 90.0) * 0.004 * sin(uv.y + iTime * 30.);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 14, 0);

    console.log('\n=== LINE 14: float wave ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float wave = sin(uv.x * 90.0)');
      expect(result).toContain('fragColor = vec4(vec3(wave), 1.0)');
    }
  });

  it('Line 18: float rain inside if', () => {
    manager.updateDebugLine(18, '      float rain = sin(uv.y * 4. + iTime * 9.0 * random(uv.xx));', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 18, 0);

    console.log('\n=== LINE 18: float rain (inside if) ===');
    console.log('Result:', result);

    // This should work - truncate mainImage at this line
    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float rain = sin(uv.y * 4.');
      // Verify the if statement has been removed (control flow stripped)
      expect(result).not.toContain('if (uv.y > wave)');
      // Verify code inside if block is still executed
      expect(result).toContain('uv /= 3.0');
    }
  });

  it('Line 20: col = mix inside if', () => {
    manager.updateDebugLine(20, '      col = mix(rainCol * rain, skyCol, 0.6);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 20, 0);

    console.log('\n=== LINE 20: col = mix (inside if) ===');
    console.log('Result:', result);

    // This requires col to be declared earlier
    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 col');
      expect(result).toContain('col = mix(rainCol * rain, skyCol, 0.6)');
      // Verify the if statement has been removed
      expect(result).not.toContain('if (uv.y > wave)');
      // Verify all code inside if block up to debug line is executed
      expect(result).toContain('uv /= 3.0');
      expect(result).toContain('float rain =');
      expect(result).toContain('rainCol *= step');
    }
  });
});
