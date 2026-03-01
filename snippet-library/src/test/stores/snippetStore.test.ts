import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the RenderQueue class. Since the module exports a singleton
// instance, we import the module fresh for each test to get a clean queue.
// Alternatively, we can test via the exported singleton and manage state carefully.

// The renderQueue is a singleton, so we re-import to get a fresh instance each time.
let renderQueue: typeof import('../../lib/stores/snippetStore')['renderQueue'];

beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../lib/stores/snippetStore');
    renderQueue = mod.renderQueue;
});

describe('RenderQueue', () => {
    describe('enqueue', () => {
        it('should execute a single enqueued callback', async () => {
            const callback = vi.fn().mockResolvedValue(undefined);
            await renderQueue.enqueue('item-1', callback);

            expect(callback).toHaveBeenCalledOnce();
        });

        it('should resolve the returned promise after the callback completes', async () => {
            let callbackResolved = false;
            const callback = vi.fn(async () => {
                callbackResolved = true;
            });

            await renderQueue.enqueue('item-1', callback);

            expect(callbackResolved).toBe(true);
        });

        it('should execute multiple enqueued items sequentially (max concurrency = 1)', async () => {
            const executionOrder: string[] = [];
            let resolveFirst!: () => void;
            const firstBlocking = new Promise<void>(r => { resolveFirst = r; });

            const firstCallback = vi.fn(async () => {
                executionOrder.push('first-start');
                await firstBlocking;
                executionOrder.push('first-end');
            });

            const secondCallback = vi.fn(async () => {
                executionOrder.push('second');
            });

            // Enqueue both without awaiting immediately
            const p1 = renderQueue.enqueue('first', firstCallback);
            const p2 = renderQueue.enqueue('second', secondCallback);

            // At this point, first should be active, second should be waiting
            // Give the microtask queue a chance to run
            await new Promise(r => setTimeout(r, 0));

            expect(executionOrder).toContain('first-start');
            expect(executionOrder).not.toContain('second');

            // Now let the first one complete
            resolveFirst();
            await p1;
            await p2;

            expect(executionOrder).toEqual(['first-start', 'first-end', 'second']);
        });

        it('should resolve even if the callback throws an error', async () => {
            const failingCallback = vi.fn(async () => {
                throw new Error('render failed');
            });

            // Should not throw - the queue catches errors internally
            await expect(renderQueue.enqueue('fail-item', failingCallback)).resolves.toBeUndefined();
        });

        it('should continue processing queue after an item fails', async () => {
            const executionOrder: string[] = [];

            const failingCallback = vi.fn(async () => {
                executionOrder.push('failing');
                throw new Error('render failed');
            });

            const successCallback = vi.fn(async () => {
                executionOrder.push('success');
            });

            const p1 = renderQueue.enqueue('fail', failingCallback);
            const p2 = renderQueue.enqueue('success', successCallback);

            await p1;
            await p2;

            expect(executionOrder).toEqual(['failing', 'success']);
            expect(successCallback).toHaveBeenCalledOnce();
        });
    });

    describe('remove', () => {
        it('should remove a pending item from the queue before it executes', async () => {
            const executionOrder: string[] = [];
            let resolveFirst!: () => void;
            const firstBlocking = new Promise<void>(r => { resolveFirst = r; });

            const firstCallback = vi.fn(async () => {
                executionOrder.push('first');
                await firstBlocking;
            });

            const secondCallback = vi.fn(async () => {
                executionOrder.push('second');
            });

            const thirdCallback = vi.fn(async () => {
                executionOrder.push('third');
            });

            const p1 = renderQueue.enqueue('first', firstCallback);
            const p2 = renderQueue.enqueue('second', secondCallback);
            const p3 = renderQueue.enqueue('third', thirdCallback);

            // Give first a chance to start
            await new Promise(r => setTimeout(r, 0));

            // Remove second while first is still running
            renderQueue.remove('second');

            resolveFirst();
            await p1;
            // p2 was removed, but the promise will never resolve because
            // the item was spliced out of the queue. Wait for p3 instead.
            await p3;

            expect(executionOrder).toEqual(['first', 'third']);
            expect(secondCallback).not.toHaveBeenCalled();
        });

        it('should be a no-op when removing an id that does not exist', () => {
            // Should not throw
            expect(() => renderQueue.remove('nonexistent')).not.toThrow();
        });

        it('should only remove the first matching item when duplicates exist', async () => {
            const executionOrder: string[] = [];
            let resolveFirst!: () => void;
            const firstBlocking = new Promise<void>(r => { resolveFirst = r; });

            const blockingCallback = vi.fn(async () => {
                executionOrder.push('blocking');
                await firstBlocking;
            });

            const dupCallback1 = vi.fn(async () => {
                executionOrder.push('dup-1');
            });

            const dupCallback2 = vi.fn(async () => {
                executionOrder.push('dup-2');
            });

            const p1 = renderQueue.enqueue('blocker', blockingCallback);
            renderQueue.enqueue('dup', dupCallback1);
            const p3 = renderQueue.enqueue('dup', dupCallback2);

            await new Promise(r => setTimeout(r, 0));

            // Remove one instance of 'dup' - should remove the first one
            renderQueue.remove('dup');

            resolveFirst();
            await p1;
            await p3;

            // Only dup-2 should have executed since dup-1 was removed
            expect(executionOrder).toEqual(['blocking', 'dup-2']);
        });
    });

    describe('ordering', () => {
        it('should process items in FIFO order', async () => {
            const executionOrder: string[] = [];

            // Enqueue three items quickly
            const p1 = renderQueue.enqueue('a', async () => { executionOrder.push('a'); });
            const p2 = renderQueue.enqueue('b', async () => { executionOrder.push('b'); });
            const p3 = renderQueue.enqueue('c', async () => { executionOrder.push('c'); });

            await Promise.all([p1, p2, p3]);

            expect(executionOrder).toEqual(['a', 'b', 'c']);
        });
    });
});
