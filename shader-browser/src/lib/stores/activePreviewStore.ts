import { writable } from 'svelte/store';

/**
 * Store to track which shader preview is currently active.
 * Only one preview should be rendering at a time.
 */
export const activePreviewPath = writable<string | null>(null);

/**
 * Global lock for thumbnail rendering to ensure only one renders at a time
 */
let thumbnailRenderLock: Promise<void> = Promise.resolve();

export async function acquireThumbnailLock<T>(fn: () => Promise<T>): Promise<T> {
  const currentLock = thumbnailRenderLock;
  let releaseLock: () => void;
  
  thumbnailRenderLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  
  await currentLock;
  
  try {
    return await fn();
  } finally {
    releaseLock!();
  }
}
