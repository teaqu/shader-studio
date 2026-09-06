/** Per-file edit history for the standalone virtual workspace, persisted in the browser. */

export interface FileRevision {
  id: string;
  path: string;
  contents: string;
  timestamp: number;
  size: number;
}

export interface FileHistoryStore {
  load(): Promise<FileRevision[] | null>;
  save(revisions: FileRevision[]): Promise<void>;
  clear(): Promise<void>;
}

export interface FileHistoryOptions {
  minIntervalMs?: number;
  /** Snapshots newer than this are all kept; older ones combine to one per day. Defaults to seven days. */
  recentMs?: number;
}

/** Change notifications consumed by the virtual workspace. */
export interface WorkspaceHistorySink {
  recordOverwrite(path: string, previousContents: string): void;
  renameHistory(sourcePath: string, destinationPath: string): void;
  dropHistory(path: string): void;
  clearHistory(): void;
}

const DEFAULT_MIN_INTERVAL_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_MS = 7 * DAY_MS;
const INTERNAL_PATH_PREFIX = '/.shader-studio/';

function cloneRevisions(revisions: FileRevision[]): FileRevision[] {
  return revisions.map((revision) => ({ ...revision }));
}

export class MemoryFileHistoryStore implements FileHistoryStore {
  private revisions: FileRevision[] | null = null;

  async load(): Promise<FileRevision[] | null> {
    return this.revisions ? cloneRevisions(this.revisions) : null;
  }

  async save(revisions: FileRevision[]): Promise<void> {
    this.revisions = cloneRevisions(revisions);
  }

  async clear(): Promise<void> {
    this.revisions = null;
  }
}

export class IndexedDbFileHistoryStore implements FileHistoryStore {
  constructor(
    private readonly databaseName = 'shader-studio-web',
    private readonly recordKey = 'file-history',
  ) {}

  async load(): Promise<FileRevision[] | null> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction('state', 'readonly').objectStore('state').get(this.recordKey);
      request.onsuccess = () => {
        database.close();
        resolve(Array.isArray(request.result) ? cloneRevisions(request.result) : null);
      };
      request.onerror = () => {
        database.close();
        reject(request.error ?? new Error('Failed to load the file history'));
      };
    });
  }

  async save(revisions: FileRevision[]): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      transaction.objectStore('state').put(cloneRevisions(revisions), this.recordKey);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error('Failed to save the file history'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error('Saving the file history was aborted'));
      };
    });
  }

  async clear(): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      transaction.objectStore('state').delete(this.recordKey);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error('Failed to clear the file history'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error('Clearing the file history was aborted'));
      };
    });
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('state')) {
          request.result.createObjectStore('state');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open the file history database'));
    });
  }
}

export class FileHistory implements WorkspaceHistorySink {
  private readonly changeHandlers = new Set<() => void>();
  private pendingSave: Promise<void> = Promise.resolve();
  private sequence = 0;

  private constructor(
    private readonly store: FileHistoryStore,
    private revisions: FileRevision[],
    private readonly now: () => number,
    private readonly minIntervalMs: number,
    private readonly recentMs: number,
  ) {}

  static async open(
    store: FileHistoryStore,
    options: FileHistoryOptions = {},
    now: () => number = () => Date.now(),
  ): Promise<FileHistory> {
    const stored = await store.load();
    return new FileHistory(
      store,
      stored ?? [],
      now,
      options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
      options.recentMs ?? DEFAULT_RECENT_MS,
    );
  }

  recordOverwrite(path: string, previousContents: string): void {
    if (this.isInternalPath(path)) {
      return;
    }
    const timestamp = this.now();
    const latest = this.latestForPath(path);
    if (latest && (latest.contents === previousContents || timestamp - latest.timestamp < this.minIntervalMs)) {
      return;
    }
    this.addRevision(path, previousContents, timestamp);
  }

  /**
   * Records the pre-restore contents before a history restore overwrites the
   * file, bypassing coalescing so the restore itself stays undoable. The
   * workspace write that follows is then deduplicated against this snapshot.
   */
  recordRestorePoint(path: string, contents: string): void {
    if (this.isInternalPath(path)) {
      return;
    }
    if (this.latestForPath(path)?.contents === contents) {
      return;
    }
    this.addRevision(path, contents, this.now());
  }

  renameHistory(sourcePath: string, destinationPath: string): void {
    let changed = false;
    this.revisions = this.revisions.map((revision) => {
      if (revision.path !== sourcePath) {
        return revision;
      }
      changed = true;
      return { ...revision, path: destinationPath };
    });
    if (changed) {
      this.queueSave();
      this.notifyChanged();
    }
  }

  dropHistory(path: string): void {
    const remaining = this.revisions.filter((revision) => revision.path !== path);
    if (remaining.length === this.revisions.length) {
      return;
    }
    this.revisions = remaining;
    this.queueSave();
    this.notifyChanged();
  }

  clearHistory(): void {
    if (this.revisions.length === 0) {
      return;
    }
    this.revisions = [];
    this.queueSave();
    this.notifyChanged();
  }

  listPaths(): string[] {
    const latestByPath = new Map<string, number>();
    for (const revision of this.revisions) {
      const known = latestByPath.get(revision.path);
      if (known === undefined || revision.timestamp > known) {
        latestByPath.set(revision.path, revision.timestamp);
      }
    }
    return [...latestByPath.entries()]
      .sort((first, second) => second[1] - first[1])
      .map(([path]) => path);
  }

  listRevisions(path: string): FileRevision[] {
    return this.revisions.filter((revision) => revision.path === path).map((revision) => ({ ...revision }));
  }

  getRevision(path: string, id: string): FileRevision | null {
    const revision = this.revisions.find((candidate) => candidate.path === path && candidate.id === id);
    return revision ? { ...revision } : null;
  }

  onChange(handler: () => void): () => void {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }

  async flush(): Promise<void> {
    await this.pendingSave;
  }

  private addRevision(path: string, contents: string, timestamp: number): void {
    this.revisions.unshift({ id: `rev-${timestamp}-${this.sequence++}`, path, contents, timestamp, size: contents.length });
    this.revisions = this.pruneRevisions(this.revisions);
    this.queueSave();
    this.notifyChanged();
  }

  /**
   * Keeps every snapshot inside the recent window and combines older
   * snapshots to the newest one per calendar day. Nothing is deleted before
   * the recent window elapses.
   */
  private pruneRevisions(revisions: FileRevision[]): FileRevision[] {
    const cutoff = this.now() - this.recentMs;
    const kept: FileRevision[] = [];
    const seenDays = new Map<string, Set<number>>();
    for (const revision of revisions) {
      if (revision.timestamp < cutoff) {
        const days = seenDays.get(revision.path) ?? new Set<number>();
        const day = Math.floor(revision.timestamp / DAY_MS);
        if (days.has(day)) {
          continue;
        }
        days.add(day);
        seenDays.set(revision.path, days);
      }
      kept.push(revision);
    }
    return kept;
  }

  private latestForPath(path: string): FileRevision | undefined {
    return this.revisions.find((revision) => revision.path === path);
  }

  private isInternalPath(path: string): boolean {
    return path.startsWith(INTERNAL_PATH_PREFIX);
  }

  private notifyChanged(): void {
    for (const handler of this.changeHandlers) {
      handler();
    }
  }

  private queueSave(): void {
    const snapshot = cloneRevisions(this.revisions);
    this.pendingSave = this.pendingSave.then(() => this.store.save(snapshot));
  }
}
