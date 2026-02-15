import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';

describe('ShaderDebugManager - UI State', () => {
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
      manager.toggleEnabled();
      manager.updateDebugLine(2, '  // just a comment', 'test.glsl');

      const result = manager.modifyShaderForDebugging(shader, 2);
      expect(result).toBeNull();
    });
  });
});
