import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager - Function Not Called in mainImage', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
  });

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

    // Debug line 12: return q;
    manager.updateDebugLine(12, '    return q;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 12, 0);

    console.log('\n=== NOT IN MAINIMAGE: Function called elsewhere but not in mainImage ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should include the function
      expect(result).toContain('vec2 sdCutHollowSphere( vec3 p, float r, float h, float t )');
      expect(result).toContain('vec2 q = vec2( length(p.xz), p.y )');
      expect(result).toContain('return q;');

      // Should generate mainImage with DEFAULT parameters (not the ones from someOtherFunction)
      expect(result).toContain('void mainImage(out vec4 fragColor, in vec2 fragCoord)');

      // Should call with defaults directly, NOT with -p or jt (which don't exist in mainImage)
      expect(result).toContain('vec2 result = sdCutHollowSphere(vec3(0.5), 0.5, 0.5, 0.5)');

      // Should NOT contain undefined variables from other function's call
      expect(result).not.toContain('sdCutHollowSphere(-p,'); // -p is undefined
      expect(result).not.toContain('jt'); // jt is undefined in mainImage

      // Should visualize vec2
      expect(result).toContain('fragColor = vec4(result, 0.0, 1.0)');
    }
  });

  it('should use actual parameters when function IS called in mainImage', () => {
    const shader = `vec2 sdCircle(vec2 p, float r) {
    return vec2(length(p) - r, 0.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 result = sdCircle(uv, 0.5);
    fragColor = vec4(result, 0.0, 1.0);
}`;

    manager.updateDebugLine(1, '    return vec2(length(p) - r, 0.0);', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== IN MAINIMAGE: Function called in mainImage ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should use actual parameters from mainImage call
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy');
      expect(result).toContain('vec2 result = sdCircle(uv, 0.5)');

      // Should NOT use default vec3(0.5) since it's called in mainImage with actual params
      expect(result).not.toContain('vec3(0.5)');
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

    manager.updateDebugLine(1, '    return length(p) - r;', 'test.glsl');
    const result = manager.modifyShaderForDebugging(shader, 1, 0);

    console.log('\n=== MULTIPLE HELPERS: Function called in multiple helpers ===');
    console.log('Result:', result);

    expect(result).not.toBeNull();
    if (result) {
      // Should use DEFAULT parameters directly in the call since not called in mainImage
      expect(result).toContain('float result = sphere(vec3(0.5), 0.5)');

      // Should NOT use parameters from helper function calls
      expect(result).not.toContain('sphere(p, 1.0)');
      expect(result).not.toContain('sphere(p + vec3(1.0), 2.0)');
    }
  });
});
