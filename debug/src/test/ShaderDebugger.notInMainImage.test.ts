import { describe, it, expect } from 'vitest';
import { ShaderDebugger } from '../ShaderDebugger';

describe('ShaderDebugger - Function Not Called in mainImage', () => {
  it('should use default parameters when function is called in other helper functions but not in mainImage', () => {
    const shader = `#define MAX_STEPS 300
#define MAX_DIST 100.0
#define SURFACE_DIST .005

vec4 jelly1 = vec4(6, 0, 0, 0.51);
vec4 jelly2 = vec4(6, 0, 0, 0.51);

// r = sphere's radius
// h = cutting's plane's position
// t = thickness
vec2 sdCutHollowSphere( vec3 p, float r, float h, float t )
{
    vec2 q = vec2( length(p.xz), p.y );
    return q;
}

float someOtherFunction(vec3 p, float jt) {
    // This function calls sdCutHollowSphere, but it's not in mainImage
    vec2 result = sdCutHollowSphere(-p, 0.7, 0.0 + jt * 0.05, 0.01);
    return result.x;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 12, '    return q;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 sdCutHollowSphere( vec3 p, float r, float h, float t )');
      expect(result).toContain('vec2 q = vec2( length(p.xz), p.y )');
      expect(result).toContain('return q;');
      expect(result).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');
      expect(result).toContain('vec2 result = sdCutHollowSphere(vec3(0.5), 0.5, 0.5, 0.5)');
      expect(result).not.toContain('sdCutHollowSphere(-p,');
      expect(result).not.toContain('jt');
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)');
    }
  });

  it('should use default parameters even when function IS called in mainImage', () => {
    const shader = `vec2 sdCircle(vec2 p, float r) {
    return vec2(length(p) - r, 0.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 result = sdCircle(uv, 0.5);
    fragColor = vec4(result, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '    return vec2(length(p) - r, 0.0);');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = sdCircle(uv, 0.5)');
    }
  });

  it('should handle function called in multiple helper functions but not mainImage', () => {
    const shader = `float sphere(vec3 p, float r) {
    return length(p) - r;
}

float scene1(vec3 p) {
    return sphere(p, 1.0);
}

float scene2(vec3 p) {
    return sphere(p + vec3(1.0), 2.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.0, 1.0);
}`;

    const result = ShaderDebugger.modifyShaderForDebugging(shader, 1, '    return length(p) - r;');

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('float result = sphere(vec3(0.5), 0.5)');
      expect(result).not.toContain('sphere(p, 1.0)');
      expect(result).not.toContain('sphere(p + vec3(1.0), 2.0)');
    }
  });
});
