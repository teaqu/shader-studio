import { describe, expect, it } from 'vitest';
import { RenderQueue } from './shaderStore';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('RenderQueue', () => {
    it('runs multiple thumbnail renders concurrently up to the configured limit', async () => {
        const queue = new RenderQueue(3);
        const first = deferred();
        const second = deferred();
        const third = deferred();
        const fourth = deferred();
        const started: string[] = [];

        const firstDone = queue.enqueue('first', async () => {
            started.push('first');
            await first.promise;
        });
        const secondDone = queue.enqueue('second', async () => {
            started.push('second');
            await second.promise;
        });
        const thirdDone = queue.enqueue('third', async () => {
            started.push('third');
            await third.promise;
        });
        const fourthDone = queue.enqueue('fourth', async () => {
            started.push('fourth');
            await fourth.promise;
        });

        await Promise.resolve();
        expect(started).toEqual(['first', 'second', 'third']);

        first.resolve();
        await firstDone;
        await Promise.resolve();
        expect(started).toEqual(['first', 'second', 'third', 'fourth']);

        second.resolve();
        third.resolve();
        fourth.resolve();
        await Promise.all([secondDone, thirdDone, fourthDone]);
    });

    it('resolves a removed queued render without running it', async () => {
        const queue = new RenderQueue(1);
        const blocker = deferred();
        const started: string[] = [];

        const firstDone = queue.enqueue('first', async () => {
            started.push('first');
            await blocker.promise;
        });
        const removedDone = queue.enqueue('removed', async () => {
            started.push('removed');
        });

        await Promise.resolve();
        queue.remove('removed');
        await removedDone;

        blocker.resolve();
        await firstDone;

        expect(started).toEqual(['first']);
    });

    it('emits queue timing events for diagnostics', async () => {
        const events: string[] = [];
        const queue = new RenderQueue(1, (event) => {
            events.push(event.type);
        });

        await queue.enqueue('diagnostic', async () => {});

        expect(events).toEqual(['enqueue', 'start', 'finish']);
    });
});
