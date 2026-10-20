import type { StorageBindingNode } from '../types/PassGraph';

type FetchBytes = (url: string) => Promise<Response>;

/** Fetches file-backed initial data for each storage node, storing the raw
 *  bytes on the node. Zero-initialised buffers are left alone. Returns one error per buffer whose file could not be used. */
export async function loadStorageInitialData(
  nodes: StorageBindingNode[],
  fetchBytes: FetchBytes = (url) => fetch(url),
): Promise<string[]> {
  const results = await Promise.all(nodes.map(async (node) => {
    node.initialBytes = undefined;
    if (!node.initialDataFiles?.length) {
      return null;
    }
    const capacity = node.count * node.stride;
    const chunks: Array<{ bytes: Uint8Array; offset: number }> = [];
    let length = 0;
    for (const file of node.initialDataFiles) {
      const offset = file.byteOffset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > capacity) {
        return `Storage ${node.name}: initial data file "${file.path}" has an invalid byte offset ${offset} (buffer holds ${capacity} bytes)`;
      }
      let bytes: Uint8Array;
      try {
        const response = await fetchBytes(file.resolved_path ?? file.path);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        return `Storage ${node.name}: unable to load initial data file "${file.path}" (${error instanceof Error ? error.message : String(error)})`;
      }
      if (bytes.byteLength > capacity - offset) {
        return `Storage ${node.name}: initial data file "${file.path}" at byte offset ${offset} needs ${offset + bytes.byteLength} bytes but the buffer holds ${capacity} bytes`;
      }
      if (bytes.byteLength) {
        chunks.push({ bytes, offset });
        length = Math.max(length, offset + bytes.byteLength);
      }
    }
    // Keep the single file fast path. Otherwise assemble once before allocation:
    // this also preserves neighbouring bytes for unaligned/overlapping writes.
    if (chunks.length === 1 && chunks[0]!.offset === 0) {
      node.initialBytes = chunks[0]!.bytes;
    } else if (length) {
      const initial = new Uint8Array(length);
      for (const chunk of chunks) {
        initial.set(chunk.bytes, chunk.offset);
      }
      node.initialBytes = initial;
    }
    return null;
  }));
  return results.filter((error): error is string => error !== null);
}

/** Cheap content identity (length + FNV-1a) so storage is reinitialised when
 *  a referenced file's bytes change, without keeping a copy in the cache key. */
export function initialDataFingerprint(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) {
    return undefined;
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.length}:${(hash >>> 0).toString(16)}`;
}
