import { describe, expect, it, vi } from 'vitest';
import { observeNearViewport } from './shaderPreviewVisibility';

describe('observeNearViewport', () => {
    it('waits until the target intersects before running the callback', () => {
        let callback!: (entries: Array<{ isIntersecting: boolean }>) => void;
        const observer = {
            observe: vi.fn(),
            disconnect: vi.fn(),
        };
        const onVisible = vi.fn();
        const target = document.createElement('div');

        observeNearViewport(target, onVisible, {
            observerFactory: (createdCallback) => {
                callback = createdCallback;
                return observer;
            },
        });

        expect(observer.observe).toHaveBeenCalledWith(target);
        expect(onVisible).not.toHaveBeenCalled();

        callback([{ isIntersecting: false }]);
        expect(onVisible).not.toHaveBeenCalled();

        callback([{ isIntersecting: true }]);
        expect(onVisible).toHaveBeenCalledTimes(1);
        expect(observer.disconnect).toHaveBeenCalledTimes(1);

        callback([{ isIntersecting: true }]);
        expect(onVisible).toHaveBeenCalledTimes(1);
    });

    it('runs immediately when IntersectionObserver is unavailable', () => {
        const target = document.createElement('div');
        const onVisible = vi.fn();

        const cleanup = observeNearViewport(target, onVisible, {
            observerFactory: undefined,
        });

        expect(onVisible).toHaveBeenCalledTimes(1);
        expect(cleanup).not.toThrow();
    });
});
