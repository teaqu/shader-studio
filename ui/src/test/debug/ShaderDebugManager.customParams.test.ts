import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';

describe('ShaderDebugManager - Custom Parameters', () => {
  let manager: ShaderDebugManager;
  const shader = `float sdf(vec2 p, float r) {
  float d = length(p) - r;
  return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(0.0);
}`;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled(); // inline rendering defaults to on
    manager.setOriginalCode(shader);
    manager.updateDebugLine(1, '  float d = length(p) - r;', '/path/shader.glsl');
  });

  describe('setCustomParameter', () => {
    it('should store a custom parameter override', () => {
      manager.setCustomParameter(0, 'vec2(1.0)');
      expect(manager.getCustomParameters().get(0)).toBe('vec2(1.0)');
    });

    it('should clear a custom parameter when set to null', () => {
      manager.setCustomParameter(0, 'vec2(1.0)');
      manager.setCustomParameter(0, null);
      expect(manager.getCustomParameters().has(0)).toBe(false);
    });

    it('should return a copy of the custom parameters map', () => {
      manager.setCustomParameter(0, 'vec2(1.0)');
      const params = manager.getCustomParameters();
      params.set(1, 'should not affect original');
      expect(manager.getCustomParameters().has(1)).toBe(false);
    });

    it('should immediately reflect custom expressions in the live function context', () => {
      manager.setCustomParameter(1, '2.0');

      expect(manager.getState().functionContext?.parameters[1].expression).toBe('2.0');
    });

    it('should reset live function context expressions back to defaults', () => {
      manager.setCustomParameter(1, '2.0');

      manager.resetCustomParameters();

      expect(manager.getState().functionContext?.parameters[1].expression).toBe('0.5');
    });
  });

  describe('setLoopMaxIterations', () => {
    it('should store a loop iteration cap', () => {
      manager.setLoopMaxIterations(0, 10);
      expect(manager.getLoopMaxIterations().get(0)).toBe(10);
    });

    it('should clear a loop iteration cap when set to null', () => {
      manager.setLoopMaxIterations(0, 10);
      manager.setLoopMaxIterations(0, null);
      expect(manager.getLoopMaxIterations().has(0)).toBe(false);
    });

    it('should return a copy of the loop max iterations map', () => {
      manager.setLoopMaxIterations(0, 10);
      const iters = manager.getLoopMaxIterations();
      iters.set(1, 99);
      expect(manager.getLoopMaxIterations().has(1)).toBe(false);
    });
  });

  describe('modifyShaderForDebugging with custom params', () => {
    it('should pass custom parameters through to ShaderDebugger', () => {
      manager.setCustomParameter(1, '2.0');

      const result = manager.modifyShaderForDebugging(shader, 1);

      expect(result).not.toBeNull();
      expect(result).toContain('sdf(uv, 2.0)');
    });

    it('should pass loop max iterations through to ShaderDebugger', () => {
      const shaderWithLoop = `float march(vec2 p) {
  float d = 0.0;
  for (int i = 0; i < 100; i++) {
    d += 0.01;
  }
  return d;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;

      // Debug line on function declaration — triggers full function execution
      manager.updateDebugLine(0, 'float march(vec2 p) {', '/path/shader.glsl');
      manager.setLoopMaxIterations(0, 5);

      const result = manager.modifyShaderForDebugging(shaderWithLoop, 0);

      expect(result).not.toBeNull();
      expect(result).toContain('int _dbgIter0 = 0;');
      expect(result).toContain('if (++_dbgIter0 > 5) break;');
    });

    it('should produce different output with custom params vs defaults', () => {
      const resultDefault = manager.modifyShaderForDebugging(shader, 1);

      manager.setCustomParameter(1, '3.14');
      const resultCustom = manager.modifyShaderForDebugging(shader, 1);

      expect(resultDefault).not.toBeNull();
      expect(resultCustom).not.toBeNull();
      expect(resultDefault).toContain('sdf(uv, 0.5)');
      expect(resultCustom).toContain('sdf(uv, 3.14)');
      expect(resultDefault).not.toEqual(resultCustom);
    });
  });
});
