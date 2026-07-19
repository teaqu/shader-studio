import { normalizeInternalPath } from "@shader-studio/slang-language-service";
import type { SlangCompileRequest } from "./SlangCompiler";

const DEFAULT_MAX_ENTRIES = 64;

export function createSlangWgslCacheKey(request: SlangCompileRequest): string {
  const files = request.workspace.files
    .map((file) => [normalizeInternalPath(file.path), file.source] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return stableStringify([
    request.source,
    normalizeInternalPath(request.sourcePath),
    request.sourceUri,
    request.workspace.rootUri,
    files,
    request.options,
  ]);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, sortObjectKeys(nested)]),
    );
  }
  return value;
}

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
