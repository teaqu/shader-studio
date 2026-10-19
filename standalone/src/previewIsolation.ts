/**
 * Pull request previews are served from the live app's origin, so without
 * isolation they would read, migrate and overwrite the visitor's real
 * workspace and preferences. A preview build (one with `VITE_PREVIEW_CHANNEL`
 * set) keeps everything it stores under its own channel instead.
 */
const PRODUCTION_CHANNEL = 'production';
const DATABASE_NAME = 'shader-studio-web';
const JOURNAL_KEY = 'shader-studio-workspace-journal';

/** The preview channel, or null for the production build. */
export function previewChannel(channel: string | undefined = import.meta.env.VITE_PREVIEW_CHANNEL): string | null {
  return channel && channel !== PRODUCTION_CHANNEL ? channel : null;
}

export function workspaceDatabaseName(channel: string | null): string {
  return channel ? `${DATABASE_NAME}-${channel}` : DATABASE_NAME;
}

export function workspaceJournalKey(channel: string | null): string {
  return channel ? `${JOURNAL_KEY}-${channel}` : JOURNAL_KEY;
}

/** A view of `storage` that only sees and changes keys under `prefix`. */
export function namespacedStorage(storage: Storage, prefix: string): Storage {
  const ownKeys = (): string[] => Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key?.startsWith(prefix) ?? false);
  return {
    get length() {
      return ownKeys().length;
    },
    key: (index) => ownKeys()[index]?.slice(prefix.length) ?? null,
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
    clear: () => ownKeys().forEach((key) => storage.removeItem(key)),
  };
}

/**
 * Replaces `localStorage` and `sessionStorage` with namespaced views. It must
 * run before any module that reads storage while it loads. Returns whether
 * every available storage was replaced; a blocked storage is left alone.
 */
export function installPreviewStorage(channel: string | null, target: typeof globalThis = globalThis): boolean {
  if (!channel) {
    return false;
  }
  let installed = true;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    let storage: Storage;
    try {
      storage = target[name];
    } catch {
      continue;
    }
    if (!storage) {
      continue;
    }
    const view = namespacedStorage(storage, `shader-studio-preview:${channel}:`);
    try {
      Object.defineProperty(target, name, { configurable: true, get: () => view });
      installed &&= target[name] === view;
    } catch {
      installed = false;
    }
  }
  return installed;
}
