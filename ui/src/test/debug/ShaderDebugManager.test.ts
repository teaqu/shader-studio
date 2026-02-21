import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';

describe('ShaderDebugManager - UI State', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
  });

  describe('Toggle and State Management', () => {
    it('should start with correct initial state', () => {
      const state = manager.getState();
      expect(state.isEnabled).toBe(false);
      expect(state.isActive).toBe(false);
      expect(state.functionContext).toBeNull();
      expect(state.isLineLocked).toBe(false);
      expect(state.isInlineRenderingEnabled).toBe(true);
      expect(state.normalizeMode).toBe('off');
      expect(state.isStepEnabled).toBe(false);
      expect(state.stepEdge).toBe(0.5);
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

    it('should preserve isInlineRenderingEnabled when toggling debug', () => {
      manager.toggleEnabled(); // enable
      expect(manager.getState().isInlineRenderingEnabled).toBe(true);

      manager.toggleInlineRendering(); // turn off inline rendering
      expect(manager.getState().isInlineRenderingEnabled).toBe(false);

      manager.toggleEnabled(); // disable
      expect(manager.getState().isInlineRenderingEnabled).toBe(false); // preserved

      manager.toggleEnabled(); // enable again
      expect(manager.getState().isInlineRenderingEnabled).toBe(false); // still preserved
    });

    it('should reset isLineLocked when disabling debug', () => {
      manager.toggleEnabled();
      manager.updateDebugLine(5, 'float x = 1.0;', 'test.glsl');
      manager.toggleLineLock();
      expect(manager.getState().isLineLocked).toBe(true);

      manager.toggleEnabled(); // disable
      expect(manager.getState().isLineLocked).toBe(false);
    });

    it('should not reset settings when disabling debug (except line lock)', () => {
      manager.toggleEnabled(); // enable
      manager.cycleNormalizeMode(); // set to 'soft'
      manager.toggleStep(); // enable step

      manager.toggleEnabled(); // disable
      const state = manager.getState();
      expect(state.normalizeMode).toBe('soft'); // preserved
      expect(state.isStepEnabled).toBe(true); // preserved
      expect(state.isLineLocked).toBe(false); // reset
    });
  });

  describe('Normalization and Step', () => {
    it('should cycle through normalize modes (off, soft, abs)', () => {
      expect(manager.getState().normalizeMode).toBe('off');

      manager.cycleNormalizeMode();
      expect(manager.getState().normalizeMode).toBe('soft');

      manager.cycleNormalizeMode();
      expect(manager.getState().normalizeMode).toBe('abs');

      manager.cycleNormalizeMode();
      expect(manager.getState().normalizeMode).toBe('off');
    });

    it('should toggle step independently', () => {
      expect(manager.getState().isStepEnabled).toBe(false);

      manager.toggleStep();
      expect(manager.getState().isStepEnabled).toBe(true);

      manager.toggleStep();
      expect(manager.getState().isStepEnabled).toBe(false);
    });

    it('should set step edge', () => {
      manager.setStepEdge(0.75);
      expect(manager.getState().stepEdge).toBe(0.75);
    });

    it('should notify state callback when step edge changes', () => {
      let callCount = 0;
      manager.setStateCallback(() => callCount++);

      manager.setStepEdge(0.3);
      expect(callCount).toBe(1);
    });

    it('should apply step post-processing when step is enabled', () => {
      const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float d = length(fragCoord);
  fragColor = vec4(vec3(d), 1.0);
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(1, '  float d = length(fragCoord);', 'test.glsl');
      manager.toggleStep();
      manager.setStepEdge(0.75);

      const result = manager.modifyShaderForDebugging(shader, 1);
      expect(result).not.toBeNull();
      expect(result).toContain('step(');
      expect(result).toContain('0.7500');
    });

    it('should not apply step when step is disabled', () => {
      const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float d = length(fragCoord);
  fragColor = vec4(vec3(d), 1.0);
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(1, '  float d = length(fragCoord);', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 1);
      expect(result).not.toBeNull();
      expect(result).not.toContain('step threshold');
    });

    it('should combine step with normalize modes', () => {
      const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float d = length(fragCoord);
  fragColor = vec4(vec3(d), 1.0);
}`;
      manager.toggleEnabled();
      manager.updateDebugLine(1, '  float d = length(fragCoord);', 'test.glsl');
      manager.cycleNormalizeMode(); // soft
      manager.toggleStep();

      const result = manager.modifyShaderForDebugging(shader, 1);
      expect(result).not.toBeNull();
      expect(result).toContain('abs(d)'); // soft normalization
      expect(result).toContain('step('); // step post-processing
    });
  });

  describe('Edge Cases', () => {
    it('should return null when debug mode is disabled', () => {
      const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {}`;
      manager.updateDebugLine(0, 'vec2 uv = fragCoord;', 'test.glsl');
      // Don't toggle enabled

      const result = manager.modifyShaderForDebugging(shader, 0);
      expect(result).toBeNull();
    });

    it('should return null when no variable is detected', () => {
      const shader = `
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  // just a comment
}`;
      manager.toggleEnabled(); // inline rendering on by default
      manager.updateDebugLine(2, '  // just a comment', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 2);
      expect(result).toBeNull();
    });

    it('should return null when inline rendering is disabled and no post-processing', () => {
      const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;
      manager.toggleEnabled();
      manager.toggleInlineRendering(); // turn off (default is on)
      manager.updateDebugLine(1, '  vec2 uv = fragCoord / iResolution.xy;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 1);
      expect(result).toBeNull();
    });

    it('should apply full-shader post-processing when inline off but normalize active', () => {
      const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;
      manager.toggleEnabled();
      manager.toggleInlineRendering(); // turn off
      manager.cycleNormalizeMode(); // set to soft
      manager.updateDebugLine(1, '  vec2 uv = fragCoord / iResolution.xy;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 1);
      expect(result).not.toBeNull();
      expect(result).toContain('fragColor.rgb = fragColor.rgb / (abs(fragColor.rgb)');
    });

    it('should return modified code when inline rendering is enabled', () => {
      const shader = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  fragColor = vec4(uv, 0.0, 1.0);
}`;
      manager.toggleEnabled(); // inline rendering defaults to on
      manager.updateDebugLine(1, '  vec2 uv = fragCoord / iResolution.xy;', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 1);
      expect(result).not.toBeNull();
      expect(result).toContain('vec2 uv = fragCoord / iResolution.xy;');
    });
  });
});
