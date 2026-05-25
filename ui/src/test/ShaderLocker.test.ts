import { describe, it, expect, beforeEach } from 'vitest';
import { ShaderLocker } from '../lib/ShaderLocker';

describe('ShaderLocker', () => {
  let shaderLocker: ShaderLocker;

  beforeEach(() => {
    shaderLocker = new ShaderLocker();
  });

  describe('when created', () => {
    it('then should not be locked', () => {
      expect(shaderLocker.isLocked()).toBe(false);
    });

    it('then should have no locked shader path', () => {
      expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
    });
  });

  describe('when toggling lock from unlocked state', () => {
    it('then should lock with shader path', () => {
      shaderLocker.toggleLock('test.glsl');

      expect(shaderLocker.isLocked()).toBe(true);
      expect(shaderLocker.getLockedShaderPath()).toBe('test.glsl');
    });

    it('then should refuse to lock without shader path', () => {
      shaderLocker.toggleLock();

      expect(shaderLocker.isLocked()).toBe(false);
      expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
    });
  });

  describe('when toggling lock from locked state', () => {
    it('then should unlock', () => {
      shaderLocker.toggleLock('test.glsl');

      shaderLocker.toggleLock();

      expect(shaderLocker.isLocked()).toBe(false);
      expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
    });
  });

  describe('when performing multiple operations', () => {
    it('then should handle lock/unlock cycles correctly', () => {
      shaderLocker.toggleLock('shader1.glsl');
      expect(shaderLocker.isLocked()).toBe(true);
      expect(shaderLocker.getLockedShaderPath()).toBe('shader1.glsl');

      shaderLocker.toggleLock();
      expect(shaderLocker.isLocked()).toBe(false);
      expect(shaderLocker.getLockedShaderPath()).toBe(undefined);

      shaderLocker.toggleLock('shader2.glsl');
      expect(shaderLocker.isLocked()).toBe(true);
      expect(shaderLocker.getLockedShaderPath()).toBe('shader2.glsl');
    });
  });
});
