import { writable, type Writable } from 'svelte/store';
import type { ShaderFile } from '../types/ShaderFile';

export const shadersStore: Writable<ShaderFile[]> = writable([]);
export const selectedShader: Writable<ShaderFile | null> = writable(null);
export const searchQuery: Writable<string> = writable('');

// Rendering queue to limit concurrent WebGL contexts
const MAX_CONCURRENT_RENDERS = 3;

interface RenderQueueItem {
  id: string;
  callback: () => Promise<void>;
  resolve: () => void;
}

class RenderQueue {
  private queue: RenderQueueItem[] = [];
  private activeCount = 0;

  async enqueue(id: string, callback: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ id, callback, resolve });
      this.processQueue();
    });
  }

  private async processQueue() {
    while (this.activeCount < MAX_CONCURRENT_RENDERS && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.activeCount++;
      
      try {
        await item.callback();
      } catch (err) {
        console.error('Render queue item failed:', err);
      } finally {
        this.activeCount--;
        item.resolve();
        // Process next items in queue
        this.processQueue();
      }
    }
  }

  remove(id: string) {
    const index = this.queue.findIndex(item => item.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
  }
}

export const renderQueue = new RenderQueue();
