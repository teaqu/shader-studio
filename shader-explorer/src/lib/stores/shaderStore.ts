import { writable, type Writable } from 'svelte/store';
import type { ShaderFile } from '../types/ShaderFile';

export const shadersStore: Writable<ShaderFile[]> = writable([]);
export const selectedShader: Writable<ShaderFile | null> = writable(null);
export const searchQuery: Writable<string> = writable('');

// Rendering queue to limit concurrent WebGL contexts while still letting the
// first page warm thumbnails in parallel.
const MAX_CONCURRENT_RENDERS = 3;

interface RenderQueueItem {
  id: string;
  callback: () => Promise<void>;
  resolve: () => void;
  enqueuedAt: number;
}

interface RenderQueueEvent {
  type: 'enqueue' | 'start' | 'finish' | 'remove';
  id: string;
  activeCount: number;
  queuedCount: number;
  maxConcurrentRenders: number;
  waitMs?: number;
  durationMs?: number;
}

type RenderQueueLogger = (event: RenderQueueEvent) => void;

export class RenderQueue {
  private queue: RenderQueueItem[] = [];
  private activeCount = 0;

  constructor(
    private maxConcurrentRenders = MAX_CONCURRENT_RENDERS,
    private onEvent: RenderQueueLogger | null = null,
  ) {}

  async enqueue(id: string, callback: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      const item = { id, callback, resolve, enqueuedAt: performance.now() };
      this.queue.push(item);
      this.emit('enqueue', item);
      void this.processQueue();
    });
  }

  private async processQueue() {
    while (this.activeCount < this.maxConcurrentRenders && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.activeCount++;
      const startedAt = performance.now();
      this.emit('start', item, {
        waitMs: startedAt - item.enqueuedAt,
      });
      
      try {
        await item.callback();
      } catch (err) {
        console.error('Render queue item failed:', err);
      } finally {
        this.activeCount--;
        item.resolve();
        this.emit('finish', item, {
          waitMs: startedAt - item.enqueuedAt,
          durationMs: performance.now() - startedAt,
        });
        // Process next items in queue
        void this.processQueue();
      }
    }
  }

  remove(id: string) {
    const index = this.queue.findIndex(item => item.id === id);
    if (index !== -1) {
      const [item] = this.queue.splice(index, 1);
      item.resolve();
      this.emit('remove', item, {
        waitMs: performance.now() - item.enqueuedAt,
      });
    }
  }

  private emit(
    type: RenderQueueEvent['type'],
    item: RenderQueueItem,
    timing: Pick<RenderQueueEvent, 'waitMs' | 'durationMs'> = {},
  ): void {
    this.onEvent?.({
      type,
      id: item.id,
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      maxConcurrentRenders: this.maxConcurrentRenders,
      ...timing,
    });
  }
}

export const renderQueue = new RenderQueue();
