import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../lib/ShaderDebugManager';

describe('ShaderDebugManager', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
  });

  describe('Toggle and State Management', () => {
    it('should start disabled', () => {
      const state = manager.getState();
      expect(state.isEnabled).toBe(false);
      expect(state.isActive).toBe(false);
    });

    it('should toggle enabled state', () => {
      manager.toggleEnabled();
      expect(manager.getState().isEnabled).toBe(true);

      manager.toggleEnabled();
      expect(manager.getState().isEnabled).toBe(false);
    });

    it('should become active when enabled and line is set', () => {
      manager.updateDebugLine(5, 'float x = 1.0;', 'test.glsl');
      expect(manager.getState().isActive).toBe(false); // Not enabled yet

      manager.toggleEnabled();
      expect(manager.getState().isActive).toBe(true); // Now active
    });

    it('should call state callback on changes', () => {
      let callCount = 0;
      manager.setStateCallback(() => callCount++);

      manager.toggleEnabled(); // 1
      manager.updateDebugLine(5, 'float x = 1.0;', 'test.glsl'); // 2

      expect(callCount).toBe(2);
    });
  });

  describe('Variable Detection - Declarations', () => {
    const testCases = [
      { line: '  float x = 1.0;', expectedType: 'float', expectedName: 'x' },
      { line: '  vec2 uv = fragCoord / iResolution.xy;', expectedType: 'vec2', expectedName: 'uv' },
      { line: '  vec3 color = vec3(1.0, 0.5, 0.0);', expectedType: 'vec3', expectedName: 'color' },
      { line: '  vec4 result = vec4(color, 1.0);', expectedType: 'vec4', expectedName: 'result' },
      { line: 'mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));', expectedType: 'mat2', expectedName: 'rot' },
    ];

    testCases.forEach(({ line, expectedType, expectedName }) => {
      it(`should detect ${expectedType} declaration: ${line}`, () => {
        const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  ${line}
}`;
        manager.toggleEnabled();
        manager.updateDebugLine(2, line, 'test.glsl');

        const result = manager.modifyShaderForDebugging(shader, 2, 0);
        expect(result).not.toBeNull();
        expect(result).toContain(expectedName);
      });
    });
  });

  describe('Variable Detection - Reassignments', () => {
    it('should detect compound assignments (+=, *=, etc.)', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv *= 2.0;
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(3, '  uv *= 2.0;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 3, 0);
      expect(result).not.toBeNull();
      expect(result).toContain('uv');
      expect(result).toContain('vec4(uv');
    });

    it('should detect regular reassignments', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv = uv * 2.0 - 1.0;
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(3, '  uv = uv * 2.0 - 1.0;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 3, 0);
      expect(result).not.toBeNull();
      expect(result).toContain('uv');
    });
  });

  describe('Variable Detection - Member Access', () => {
    it('should detect member access assignments (uv.x *=)', () => {
      const shader = `
void mainImage(out vec4 fragCoord, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.x *= iResolution.x / iResolution.y;
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(3, '  uv.x *= iResolution.x / iResolution.y;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 3, 0);
      expect(result).not.toBeNull();
      expect(result).toContain('uv');
      expect(result).toContain('vec4(uv');
    });

    it('should detect color component assignments', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 color = vec3(1.0);
  color.r *= 0.5;
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(3, '  color.r *= 0.5;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 3, 0);
      expect(result).not.toBeNull();
      expect(result).toContain('color');
      expect(result).toContain('vec4(color');
    });
  });

  describe('Return Statement Generation', () => {
    it('should generate correct return for float', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float value = 0.5;
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(2, '  float value = 0.5;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 2, 0);
      expect(result).toContain('vec4(vec3(value), 1.0)');
    });

    it('should generate correct return for vec2', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(2, '  vec2 uv = fragCoord / iResolution.xy;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 2, 0);
      expect(result).toContain('vec4(uv, 0.0, 1.0)');
    });

    it('should generate correct return for vec3', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 color = vec3(1.0, 0.5, 0.0);
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(2, '  vec3 color = vec3(1.0, 0.5, 0.0);', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 2, 0);
      expect(result).toContain('vec4(color, 1.0)');
    });
  });

  describe('MainImage Function Detection', () => {
    it('should work inside mainImage', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(2, '  vec2 uv = fragCoord / iResolution.xy;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 2, 0);
      expect(result).not.toBeNull();
      expect(result).toContain('void mainImage');
    });

    it('should truncate shader at debug line', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float circle = length(uv);
  vec3 finalColor = vec3(circle) * 2.0;
  fragColor = vec4(finalColor, 1.0);
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(3, '  float circle = length(uv);', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 3, 0);
      expect(result).not.toBeNull();
      expect(result).toContain('float circle = length(uv)');
      // Original lines after debug line should be removed
      expect(result).not.toContain('finalColor');
      expect(result).not.toContain('vec3(circle) * 2.0');
    });
  });

  describe('Helper Functions', () => {
    it.todo('should handle debugging inside helper functions', () => {
      // TODO: This feature is experimental and needs more work
      // The challenge is correctly wrapping helper functions and generating
      // appropriate test inputs
      const shader = `
float spiralSDF(vec2 st, float turns) {
  float r = length(st);
  float a = atan(st.x, st.y);
  return step(0.1, sin(r * turns + a));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float l = spiralSDF(uv, 50.0);
  fragColor = vec4(vec3(l), 1.0);
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(2, '  float r = length(st);', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 2, 0);
      expect(result).not.toBeNull();
      // Should contain the spiralSDF function
      expect(result).toContain('spiralSDF');
      expect(result).toContain('float r = length(st)');
    });
  });

  describe('One-Liners', () => {
    it('should handle one-liners outside functions', () => {
      manager.toggleEnabled();
      manager.updateDebugLine(0, 'vec3 col = vec3(1.0, 0.5, 0.2);', 'test.glsl');

      const result = manager.modifyShaderForDebugging(
        'vec3 col = vec3(1.0, 0.5, 0.2);',
        0,
        0
      );
      expect(result).not.toBeNull();
      expect(result).toContain('void mainImage');
      expect(result).toContain('vec3 col = vec3(1.0, 0.5, 0.2)');
      expect(result).toContain('vec4(col, 1.0)');
    });
  });

  describe('Edge Cases', () => {
    it('should return null when debug mode is disabled', () => {
      const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {}`;
      manager.updateDebugLine(0, 'vec2 uv = fragCoord;', 'test.glsl');
      // Don't toggle enabled

      const result = manager.modifyShaderForDebugging(shader, 0, 0);
      expect(result).toBeNull();
    });

    it('should return null when no variable is detected', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // just a comment
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(2, '  // just a comment', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 2, 0);
      expect(result).toBeNull();
    });

    it('should handle multiple variables of same name in different scopes', () => {
      const shader = `
void helper() {
  float x = 1.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float x = 2.0;
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(6, '  float x = 2.0;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 6, 0);
      expect(result).not.toBeNull();
      expect(result).toContain('float x = 2.0');
    });
  });
});
