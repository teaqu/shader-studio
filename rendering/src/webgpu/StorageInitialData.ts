import type { StorageBindingNode } from '../types/PassGraph';

type FetchBytes = (url: string) => Promise<Response>;

/** Fetches file-backed initial data for each storage node, storing the raw
 *  bytes on the node. Zero-initialised buffers are left alone. Returns one error per buffer whose file could not be used. */
export async function loadStorageInitialData(
  nodes: StorageBindingNode[],
  fetchBytes: FetchBytes = (url) => fetch(url),
): Promise<string[]> {
  const results = await Promise.all(nodes.map(async (node) => {
    if (!node.initialDataUrl) {
      return null;
    }
    node.initialBytes = undefined;
    const label = node.initialDataPath ?? node.initialDataUrl;
    let bytes: Uint8Array;
    try {
      const response = await fetchBytes(node.initialDataUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return `Storage ${node.name}: unable to load initial data file "${label}" (${error instanceof Error ? error.message : String(error)})`;
    }
    const capacity = node.count * node.stride;
    if (bytes.byteLength > capacity) {
      return `Storage ${node.name}: initial data file "${label}" is ${bytes.byteLength} bytes but the buffer holds ${capacity} bytes`;
    }
    node.initialBytes = bytes;
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
