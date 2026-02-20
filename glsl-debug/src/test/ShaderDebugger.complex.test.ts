import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Complex Shader', () => {
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

  it('Line 0: global vec3 rainCol', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 0, 'vec3 rainCol = vec3(0.5608, 0.4078, 0.9843);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 rainCol = vec3(0.5608, 0.4078, 0.9843)');
      expect(result).toContain('fragColor = vec4(rainCol, 1.0)');
    }
  });

  it('Line 1: global vec3 skyCol', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, 'vec3 skyCol = vec3(0.0, 0.3686, 1.0);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 skyCol = vec3(0.0, 0.3686, 1.0)');
      expect(result).toContain('fragColor = vec4(skyCol, 1.0)');
    }
  });

  it('Line 4: return in random() function', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 4, '  return fract(sin(uv.x * 1920. + uv.y * 3092.) * 4039.);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float _dbgReturn = fract(sin(uv.x * 1920.');
      expect(result).toContain('random(uv)');
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
    }
  });

  it('Line 9: vec2 uv declaration in mainImage', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 9, '    vec2 uv = fragCoord/iResolution.xy;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('Line 10: uv reassignment in mainImage', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 10, '    uv = fragCoord/iResolution.xy * 2.0 - 1.0;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 uv = fragCoord/iResolution.xy');
      expect(result).toContain('uv = fragCoord/iResolution.xy * 2.0 - 1.0');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('Line 11: uv.y += in mainImage', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 11, '    uv.y += 0.9;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('uv.y += 0.9');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('Line 13: uv *= in mainImage', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 13, '    uv *= 1.0;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('uv *= 1.0');
      expect(result).toContain('fragColor = vec4(uv, 0.0, 1.0)');
    }
  });

  it('Line 14: float wave declaration', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 14, '    float wave = sin(uv.x * 90.0) * 0.004 * sin(uv.y + iTime * 30.);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float wave = sin(uv.x * 90.0)');
      expect(result).toContain('fragColor = vec4(vec3(wave), 1.0)');
    }
  });

  it('Line 18: float rain inside if — if preserved', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 18, '      float rain = sin(uv.y * 4. + iTime * 9.0 * random(uv.xx));');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float rain = sin(uv.y * 4.');
      // if/else are now preserved (not stripped)
      expect(result).toContain('if (uv.y > wave)');
      expect(result).toContain('uv /= 3.0');
    }
  });

  it('Line 20: col = mix inside if — if preserved', () => {
    const result = ShaderDebugger.modifyShaderForDebugging(shader, 20, '      col = mix(rainCol * rain, skyCol, 0.6);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec3 col');
      expect(result).toContain('col = mix(rainCol * rain, skyCol, 0.6)');
      // if/else are now preserved (not stripped)
      expect(result).toContain('if (uv.y > wave)');
      expect(result).toContain('uv /= 3.0');
      expect(result).toContain('float rain =');
      expect(result).toContain('rainCol *= step');
    }
  });
});
