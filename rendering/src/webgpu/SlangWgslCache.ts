const DEFAULT_MAX_ENTRIES = 64;

/**
 * Small in-memory LRU for Slang-to-WGSL output. This keeps switching back to
 * an unchanged Slang shader fast after a WebGPU engine was recreated, while
 * intentionally storing only source text output, never GPU/device resources,
 * so fresh engines can rebuild their own pipelines safely.
 */
export class SlangWgslCache {
  private entries = new Map<string, string>();

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  get(key: string): string | null {
    const value = this.entries.get(key);
    if (value === undefined) {
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, wgsl: string): void {
    if (this.maxEntries <= 0) {
      return;
    }

    this.entries.delete(key);
    this.entries.set(key, wgsl);

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export const sharedSlangWgslCache = new SlangWgslCache();
