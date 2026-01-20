import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderLocker } from '../lib/ShaderLocker';

describe('ShaderLocker', () => {
    let shaderLocker: ShaderLocker;
    let consoleSpy: any;

    beforeEach(() => {
        shaderLocker = new ShaderLocker();
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
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
            expect(consoleSpy).toHaveBeenCalledWith('ShaderLocker: Locked to shader at path: test.glsl');
        });

        it('then should lock without shader path', () => {
            shaderLocker.toggleLock();

            expect(shaderLocker.isLocked()).toBe(true);
            expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
            expect(consoleSpy).toHaveBeenCalledWith('ShaderLocker: Locked to shader at path: unknown');
        });
    });

    describe('when toggling lock from locked state', () => {
        it('then should unlock', () => {
            shaderLocker.toggleLock('test.glsl');
            consoleSpy.mockClear();

            shaderLocker.toggleLock();

            expect(shaderLocker.isLocked()).toBe(false);
            expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
            expect(consoleSpy).toHaveBeenCalledWith('ShaderLocker: Unlocked');
        });
    });

    describe('when updating locked shader', () => {
        it('then should update shader path if locked', () => {
            shaderLocker.toggleLock('original.glsl');

            shaderLocker.updateLockedShader('updated.glsl');

            expect(shaderLocker.getLockedShaderPath()).toBe('updated.glsl');
            expect(shaderLocker.isLocked()).toBe(true);
        });

        it('then should not update shader path if not locked', () => {
            shaderLocker.updateLockedShader('test.glsl');

            expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
            expect(shaderLocker.isLocked()).toBe(false);
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
