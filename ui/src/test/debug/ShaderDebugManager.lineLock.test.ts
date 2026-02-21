import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderDebugManager } from '../../lib/ShaderDebugManager';

describe('ShaderDebugManager - Line Lock', () => {
  let manager: ShaderDebugManager;

  beforeEach(() => {
    manager = new ShaderDebugManager();
    manager.toggleEnabled();
  });

  it('should toggle isLineLocked state', () => {
    expect(manager.getState().isLineLocked).toBe(false);

    manager.toggleLineLock();
    expect(manager.getState().isLineLocked).toBe(true);

    manager.toggleLineLock();
    expect(manager.getState().isLineLocked).toBe(false);
  });

  it('should store filePath when line lock is engaged', () => {
    manager.updateDebugLine(5, 'float x = 1.0;', '/path/shader.glsl');
    manager.toggleLineLock();

    expect(manager.getState().isLineLocked).toBe(true);
    expect(manager.getState().filePath).toBe('/path/shader.glsl');
  });

  it('should ignore updateDebugLine when locked and same file', () => {
    manager.updateDebugLine(5, 'float x = 1.0;', '/path/shader.glsl');
    manager.toggleLineLock();

    // Try to update to a different line in the same file
    manager.updateDebugLine(10, 'vec2 uv = ...;', '/path/shader.glsl');

    const state = manager.getState();
    expect(state.currentLine).toBe(5);
    expect(state.lineContent).toBe('float x = 1.0;');
  });

  it('should auto-unlock and process update when different file', () => {
    manager.updateDebugLine(5, 'float x = 1.0;', '/path/shader.glsl');
    manager.toggleLineLock();

    // Update from a different file
    manager.updateDebugLine(10, 'vec2 uv = ...;', '/path/other.glsl');

    const state = manager.getState();
    expect(state.isLineLocked).toBe(false);
    expect(state.currentLine).toBe(10);
    expect(state.lineContent).toBe('vec2 uv = ...;');
    expect(state.filePath).toBe('/path/other.glsl');
  });

  it('should fire state callback when line lock changes', () => {
    let lastState = manager.getState();
    manager.setStateCallback((state) => { lastState = state; });

    manager.toggleLineLock();
    expect(lastState.isLineLocked).toBe(true);

    manager.toggleLineLock();
    expect(lastState.isLineLocked).toBe(false);
  });

  it('should preserve custom parameters across lock/unlock within same function', () => {
    const shader = `float sdf(vec2 p) {
  float d = length(p) - 0.5;
  return d;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;

    manager.setOriginalCode(shader);
    manager.updateDebugLine(1, '  float d = length(p) - 0.5;', '/path/shader.glsl');
    manager.setCustomParameter(0, 'vec2(0.3, 0.7)');

    manager.toggleLineLock();
    manager.toggleLineLock(); // unlock

    // Still in same function — params preserved
    expect(manager.getCustomParameters().get(0)).toBe('vec2(0.3, 0.7)');
  });

  it('should clear custom parameters when auto-unlocking to different function', () => {
    const shader = `float sdf(vec2 p) {
  float d = length(p) - 0.5;
  return d;
}
vec3 getColor(vec2 uv) {
  return vec3(uv, 0.5);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(0.0);
}`;

    manager.setOriginalCode(shader);
    manager.updateDebugLine(1, '  float d = length(p) - 0.5;', '/path/shader.glsl');
    manager.setCustomParameter(0, 'vec2(0.3, 0.7)');

    manager.toggleLineLock();

    // Move to a different file (triggers auto-unlock), landing in different function
    manager.updateDebugLine(5, '  return vec3(uv, 0.5);', '/path/other.glsl');

    // Different function — params cleared
    expect(manager.getCustomParameters().size).toBe(0);
  });
});
