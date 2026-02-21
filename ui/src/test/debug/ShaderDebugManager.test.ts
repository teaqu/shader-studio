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

    it('should reset isInlineRenderingEnabled when disabling debug', () => {
      manager.toggleEnabled(); // enable
      // Default is true, verify it
      expect(manager.getState().isInlineRenderingEnabled).toBe(true);

      manager.toggleEnabled(); // disable
      expect(manager.getState().isInlineRenderingEnabled).toBe(false);

      // Re-enabling should restore the default (true)
      manager.toggleEnabled(); // enable again
      expect(manager.getState().isInlineRenderingEnabled).toBe(true);
    });

    it('should reset isLineLocked when disabling debug', () => {
      manager.toggleEnabled();
      manager.updateDebugLine(5, 'float x = 1.0;', 'test.glsl');
      manager.toggleLineLock();
      expect(manager.getState().isLineLocked).toBe(true);

      manager.toggleEnabled(); // disable
      expect(manager.getState().isLineLocked).toBe(false);
    });

    it('should call onDisableCallback when disabling debug', () => {
      const onDisable = vi.fn();
      manager.setOnDisableCallback(onDisable);

      manager.toggleEnabled(); // enable
      expect(onDisable).not.toHaveBeenCalled();

      manager.toggleEnabled(); // disable
      expect(onDisable).toHaveBeenCalledOnce();
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

    it('should return null when inline rendering is disabled', () => {
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
