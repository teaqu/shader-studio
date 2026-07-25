import type { SlangCompileRequest } from "./SlangCompiler";

const DEFAULT_MAX_ENTRIES = 64;

/** A stable, length-framed 64-bit FNV-1a digest of all compiler inputs. */
export function createSlangWgslCacheKey(request: SlangCompileRequest): string {
  let hash = 0xcbf29ce484222325n;
  const add = (value: string) => {
    const framed = `${value.length}:${value}`;
    for (let index = 0; index < framed.length; index += 1) {
      hash ^= BigInt(framed.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
  };
  const value = (item: unknown): void => {
    if (item === undefined) {
      add("u"); return;
    }
    if (item === null) {
      add("n"); return;
    }
    if (typeof item === "string") {
      add(`s${item}`); return;
    }
    if (typeof item === "number") {
      add(`d${item}`); return;
    }
    if (typeof item === "boolean") {
      add(item ? "b1" : "b0"); return;
    }
    if (Array.isArray(item)) {
      add(`a${item.length}`); item.forEach(value); return;
    }
    const object = item as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    add(`o${keys.length}`);
    keys.forEach((key) => {
      add(`k${key}`); value(object[key]);
    });
  };
  add("slang-wgsl-v2");
  value(request.sourceUri); value(request.sourcePath); value(request.workspace.rootUri); value(request.source); value(request.options);
  const files = [...request.workspace.files].sort((left, right) => left.path.localeCompare(right.path) || left.uri.localeCompare(right.uri));
  value(files.length);
  for (const file of files) {
    value(file.path); value(file.uri); value(file.source); value(file.version);
  }
  return hash.toString(16).padStart(16, "0");
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
