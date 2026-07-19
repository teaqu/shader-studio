import { normalizeInternalPath } from "@shader-studio/slang-language-service";
import type { SlangCompileRequest } from "./SlangCompiler";

const DEFAULT_MAX_ENTRIES = 64;

export function createSlangWgslCacheKey(request: SlangCompileRequest): string {
  const files = request.workspace.files
    .map((file) => [normalizeInternalPath(file.path), file.source] as const)
    .sort(([leftPath, leftSource], [rightPath, rightSource]) => {
      const pathOrder = compareText(leftPath, rightPath);
      return pathOrder === 0 ? compareText(leftSource, rightSource) : pathOrder;
    });
  const digest = new FramedHash64();
  digest.add("root-source");
  digest.add(request.source);
  digest.add("root-path");
  digest.add(normalizeInternalPath(request.sourcePath));
  digest.add("root-uri");
  digest.add(request.sourceUri);
  digest.add("workspace-root-uri");
  digest.add(request.workspace.rootUri);
  digest.add("workspace-file-count");
  digest.add(String(files.length));
  for (const [path, source] of files) {
    digest.add("workspace-file");
    digest.add(path);
    digest.add(source);
  }
  digest.add("request-options");
  digest.add(stableStringify(request.options));
  return `slang-wgsl-v1:${digest.hex()}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

class FramedHash64 {
  private left = 0x811c9dc5;
  private right = 0x9e3779b9;
  private readonly encoder = new TextEncoder();

  add(value: string): void {
    const bytes = this.encoder.encode(value);
    this.updateUint32(bytes.length);
    for (const byte of bytes) {
      this.update(byte);
    }
  }

  hex(): string {
    return `${avalanche(this.left).toString(16).padStart(8, "0")}${avalanche(this.right).toString(16).padStart(8, "0")}`;
  }

  private updateUint32(value: number): void {
    this.update(value & 0xff);
    this.update((value >>> 8) & 0xff);
    this.update((value >>> 16) & 0xff);
    this.update((value >>> 24) & 0xff);
  }

  private update(byte: number): void {
    this.left = Math.imul(this.left ^ byte, 0x01000193) >>> 0;
    this.right = Math.imul(this.right ^ byte, 0x85ebca6b) >>> 0;
  }
}

function avalanche(value: number): number {
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
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
