import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShaderLocker } from '../util/ShaderLocker';

describe('ShaderLocker', () => {
    let shaderLocker: ShaderLocker;
    let consoleSpy: any;

    beforeEach(() => {
        shaderLocker = new ShaderLocker();
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    describe('when created', () => {
        it('then should not be locked', () => {
            expect(shaderLocker.getIsLocked()).toBe(false);
        });

        it('then should have no locked shader path', () => {
            expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
        });

        it('then should process any shader', () => {
            expect(shaderLocker.shouldProcessShader('test.glsl')).toBe(true);
            expect(shaderLocker.shouldProcessShader('another.glsl')).toBe(true);
        });
    });

    describe('when toggling lock from unlocked state', () => {
        it('then should lock with shader path', () => {
            shaderLocker.toggleLock('test.glsl');

            expect(shaderLocker.getIsLocked()).toBe(true);
            expect(shaderLocker.getLockedShaderPath()).toBe('test.glsl');
            expect(consoleSpy).toHaveBeenCalledWith('ShaderLocker: Locked to shader at path: test.glsl');
        });

        it('then should lock without shader path', () => {
            shaderLocker.toggleLock();

            expect(shaderLocker.getIsLocked()).toBe(true);
            expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
            expect(consoleSpy).toHaveBeenCalledWith('ShaderLocker: Locked to shader at path: unknown');
        });
    });

    describe('when toggling lock from locked state', () => {
        it('then should unlock', () => {
            shaderLocker.toggleLock('test.glsl');
            consoleSpy.mockClear();

            shaderLocker.toggleLock();

            expect(shaderLocker.getIsLocked()).toBe(false);
            expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
            expect(consoleSpy).toHaveBeenCalledWith('ShaderLocker: Unlocked');
        });
    });

    describe('when checking if shader should be processed', () => {
        it('then should return true if not locked', () => {
            expect(shaderLocker.shouldProcessShader('test.glsl')).toBe(true);
            expect(shaderLocker.shouldProcessShader('different.glsl')).toBe(true);
        });

        it('then should return true if locked and shader names match', () => {
            shaderLocker.toggleLock('test.glsl');
            consoleSpy.mockClear();

            expect(shaderLocker.shouldProcessShader('test.glsl')).toBe(true);
            expect(consoleSpy).not.toHaveBeenCalled();
        });

        it('then should return false if locked and shader names do not match', () => {
            shaderLocker.toggleLock('test.glsl');
            consoleSpy.mockClear();

            expect(shaderLocker.shouldProcessShader('different.glsl')).toBe(false);
            expect(consoleSpy).toHaveBeenCalledWith('ShaderLocker: Ignoring shader different.glsl - locked to test.glsl');
        });

        it('then should return true if locked but no locked shader name set', () => {
            shaderLocker.toggleLock();
            consoleSpy.mockClear();

            expect(shaderLocker.shouldProcessShader('any.glsl')).toBe(true);
            expect(consoleSpy).not.toHaveBeenCalled();
        });
    });

    describe('when updating locked shader', () => {
        it('then should update shader path if locked', () => {
            shaderLocker.toggleLock('original.glsl');

            shaderLocker.updateLockedShader('updated.glsl');

            expect(shaderLocker.getLockedShaderPath()).toBe('updated.glsl');
            expect(shaderLocker.getIsLocked()).toBe(true);
        });

        it('then should not update shader path if not locked', () => {
            shaderLocker.updateLockedShader('test.glsl');

            expect(shaderLocker.getLockedShaderPath()).toBe(undefined);
            expect(shaderLocker.getIsLocked()).toBe(false);
        });
    });

    describe('when performing multiple operations', () => {
        it('then should handle lock/unlock cycles correctly', () => {
            shaderLocker.toggleLock('shader1.glsl');
            expect(shaderLocker.getIsLocked()).toBe(true);
            expect(shaderLocker.getLockedShaderPath()).toBe('shader1.glsl');

            shaderLocker.toggleLock();
            expect(shaderLocker.getIsLocked()).toBe(false);
            expect(shaderLocker.getLockedShaderPath()).toBe(undefined);

            shaderLocker.toggleLock('shader2.glsl');
            expect(shaderLocker.getIsLocked()).toBe(true);
            expect(shaderLocker.getLockedShaderPath()).toBe('shader2.glsl');
        });

        it('then should maintain state when updating locked shader', () => {
            shaderLocker.toggleLock('original.glsl');

            expect(shaderLocker.shouldProcessShader('original.glsl')).toBe(true);

            shaderLocker.updateLockedShader('new.glsl');

            expect(shaderLocker.shouldProcessShader('original.glsl')).toBe(false);
            expect(shaderLocker.shouldProcessShader('new.glsl')).toBe(true);
        });
    });
});
