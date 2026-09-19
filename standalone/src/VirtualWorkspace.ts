export interface VirtualWorkspaceFile {
  path: string;
  contents: string;
  createdAt: number;
  modifiedAt: number;
}

export interface VirtualWorkspaceStore {
  load(): Promise<VirtualWorkspaceFile[] | null>;
  save(files: VirtualWorkspaceFile[]): Promise<void>;
  clear(): Promise<void>;
}

/** Everything a store write has been asked to persist but has not confirmed:
 * the files it would add or change, and the paths it would remove. */
export interface VirtualWorkspaceJournalRecord {
  files: VirtualWorkspaceFile[];
  deleted: { path: string; at: number }[];
}

/** A synchronous record of edits whose store save has not committed yet.
 * Store writes are asynchronous and a reload abandons the ones still queued,
 * so each edit lands here first and is replayed by the next workspace. */
export interface VirtualWorkspaceJournal {
  read(): VirtualWorkspaceJournalRecord | null;
  record(record: VirtualWorkspaceJournalRecord): void;
  clear(): void;
}

function cloneFiles(files: VirtualWorkspaceFile[]): VirtualWorkspaceFile[] {
  return files.map((file) => ({ ...file }));
}

export class MemoryWorkspaceJournal implements VirtualWorkspaceJournal {
  private pending: VirtualWorkspaceJournalRecord | null = null;

  read(): VirtualWorkspaceJournalRecord | null {
    return this.pending
      ? { files: cloneFiles(this.pending.files), deleted: this.pending.deleted.map((entry) => ({ ...entry })) }
      : null;
  }

  record(record: VirtualWorkspaceJournalRecord): void {
    this.pending = { files: cloneFiles(record.files), deleted: record.deleted.map((entry) => ({ ...entry })) };
  }

  clear(): void {
    this.pending = null;
  }
}

/** Journals through `localStorage`, which commits before the keystroke that
 * caused the edit returns. Restricted or full storage degrades to no journal
 * rather than failing the edit. */
export class LocalStorageWorkspaceJournal implements VirtualWorkspaceJournal {
  constructor(
    private readonly key = 'shader-studio-workspace-journal',
    /** Read per call: storage can be absent, and reading it can throw. */
    private readonly storage: () => Storage = () => localStorage,
  ) {}

  read(): VirtualWorkspaceJournalRecord | null {
    try {
      const raw: unknown = JSON.parse(this.storage().getItem(this.key) ?? 'null');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
      }
      const { files, deleted } = raw as Partial<VirtualWorkspaceJournalRecord>;
      return {
        files: (Array.isArray(files) ? files : []).filter((file): file is VirtualWorkspaceFile =>
          !!file && typeof file.path === 'string' && typeof file.contents === 'string'
          && typeof file.createdAt === 'number' && typeof file.modifiedAt === 'number'),
        deleted: (Array.isArray(deleted) ? deleted : []).filter((entry): entry is { path: string; at: number } =>
          !!entry && typeof entry.path === 'string' && typeof entry.at === 'number'),
      };
    } catch {
      return null;
    }
  }

  record(record: VirtualWorkspaceJournalRecord): void {
    try {
      this.storage().setItem(this.key, JSON.stringify(record));
    } catch {
      // Out of quota or blocked: drop the stale record rather than replaying
      // an edit the next open cannot trust to be the newest one.
      this.clear();
    }
  }

  clear(): void {
    try {
      this.storage().removeItem(this.key);
    } catch {
      // Nothing to clear when storage is unavailable.
    }
  }
}

const noJournal: VirtualWorkspaceJournal = {
  read: () => null,
  record: () => {},
  clear: () => {},
};

export class MemoryWorkspaceStore implements VirtualWorkspaceStore {
  private files: VirtualWorkspaceFile[] | null = null;

  async load(): Promise<VirtualWorkspaceFile[] | null> {
    return this.files ? cloneFiles(this.files) : null;
  }

  async save(files: VirtualWorkspaceFile[]): Promise<void> {
    this.files = cloneFiles(files);
  }

  async clear(): Promise<void> {
    this.files = null;
  }
}

export class IndexedDbWorkspaceStore implements VirtualWorkspaceStore {
  constructor(
    private readonly databaseName = 'shader-studio-web',
    private readonly recordKey = 'workspace',
  ) {}

  async load(): Promise<VirtualWorkspaceFile[] | null> {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction('state', 'readonly').objectStore('state').get(this.recordKey);
      request.onsuccess = () => {
        database.close();
        resolve(Array.isArray(request.result) ? cloneFiles(request.result) : null);
      };
      request.onerror = () => {
        database.close();
        reject(request.error ?? new Error('Failed to load the virtual workspace'));
      };
    });
  }

  async save(files: VirtualWorkspaceFile[]): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('state', 'readwrite');
      transaction.objectStore('state').put(cloneFiles(files), this.recordKey);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error('Failed to save the virtual workspace'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error('Saving the virtual workspace was aborted'));
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
        reject(transaction.error ?? new Error('Failed to clear the virtual workspace'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error('Clearing the virtual workspace was aborted'));
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
      request.onerror = () => reject(request.error ?? new Error('Failed to open the virtual workspace database'));
    });
  }
}

export class VirtualWorkspace {
  private readonly files = new Map<string, VirtualWorkspaceFile>();
  /** The snapshot the store has confirmed. The journal carries the difference
   * between it and the files in memory. */
  private committed = new Map<string, VirtualWorkspaceFile>();
  private pendingSave: Promise<void> = Promise.resolve();
  private saveSequence = 0;
  private revision = 0;

  private constructor(
    private readonly store: VirtualWorkspaceStore,
    files: VirtualWorkspaceFile[],
    private readonly now: () => number,
    private readonly journal: VirtualWorkspaceJournal,
  ) {
    for (const file of files) {
      const path = this.normalizePath(file.path);
      this.files.set(path, { ...file, path });
    }
    this.committed = new Map([...this.files].map(([path, file]) => [path, { ...file }]));
  }

  static async open(
    store: VirtualWorkspaceStore,
    seedFiles: VirtualWorkspaceFile[],
    now: () => number = () => Date.now(),
    journal: VirtualWorkspaceJournal = noJournal,
  ): Promise<VirtualWorkspace> {
    const storedFiles = await store.load();
    const workspace = new VirtualWorkspace(store, storedFiles ?? seedFiles, now, journal);
    if (storedFiles === null) {
      workspace.queueSave();
      await workspace.flush();
      return workspace;
    }
    if (workspace.replayJournal()) {
      // Queued, not awaited: opening the workspace must not wait on the store
      // that failed to keep up in the first place. The journal survives until
      // this write commits.
      workspace.queueSave();
    }
    return workspace;
  }

  /** Apply the edits a previous session recorded but never saw committed.
   * An entry older than the stored copy is discarded: the store won that
   * race, and replaying would undo the newer text. */
  private replayJournal(): boolean {
    const pending = this.journal.read();
    if (!pending) {
      return false;
    }
    let applied = false;
    for (const file of pending.files) {
      const path = this.normalizePath(file.path);
      const stored = this.files.get(path);
      if (!stored || stored.modifiedAt < file.modifiedAt) {
        this.files.set(path, { ...file, path });
        applied = true;
      }
    }
    for (const entry of pending.deleted) {
      const path = this.normalizePath(entry.path);
      const stored = this.files.get(path);
      if (stored && stored.modifiedAt <= entry.at) {
        this.files.delete(path);
        applied = true;
      }
    }
    if (!applied) {
      this.journal.clear();
    }
    return applied;
  }

  exists(path: string): boolean {
    return this.files.has(this.normalizePath(path));
  }

  readText(path: string): string {
    return this.getFile(path).contents;
  }

  writeText(path: string, contents: string): void {
    const normalizedPath = this.normalizePath(path);
    const existing = this.files.get(normalizedPath);
    const timestamp = this.now();
    this.files.set(normalizedPath, {
      path: normalizedPath,
      contents,
      createdAt: existing?.createdAt ?? timestamp,
      modifiedAt: timestamp,
    });
    this.queueSave();
  }

  /** Monotonic commit counter. Advances exactly once per committed
   * transaction and never for a rejected one. */
  get revisionCount(): number {
    return this.revision;
  }

  /** Persist one complete snapshot, then publish all targets together.
   * Validation runs entirely before the single write, so a rejected
   * transaction never mutates and never needs a rollback. The in-memory map
   * swaps only after the store round-trips the exact snapshot. */
  async applyTextTransaction(
    changes: readonly { path: string; before: string; after: string }[],
    isCurrent: () => boolean = () => true,
    onCommit: () => void = () => {},
    /** Live open-buffer texts by path. A target with an open buffer compares
     * against it instead of the stored copy, so unsaved editor text neither
     * causes false staleness nor hides a genuine mid-flight change. Targets
     * without an open buffer keep the stored comparison. */
    openTexts?: ReadonlyMap<string, string>,
  ): Promise<void> {
    const operation = this.pendingSave.then(async () => {
      const revision = this.revision;
      const original = this.list();
      const targets = new Map<string, string>();
      for (const change of changes) {
        const path = this.normalizePath(change.path);
        // getFile first: a missing target throws here exactly as before.
        const stored = this.getFile(path).contents;
        const base = openTexts?.get(path) ?? stored;
        if (targets.has(path) || base !== change.before) {
          throw new Error('Rename target is stale or duplicated. No files were changed.');
        }
        targets.set(path, change.after);
      }
      if (revision !== this.revision || !isCurrent()) {
        throw new Error('Rename request is stale. No files were changed.');
      }
      const snapshot = original.map(file => targets.has(file.path)
        ? { ...file, contents: targets.get(file.path)!, modifiedAt: this.now() } : file);
      await this.store.save(snapshot);
      const persisted = await this.store.load();
      if (JSON.stringify(persisted) !== JSON.stringify(snapshot)) {
        throw new Error('Workspace store did not persist the snapshot. No files were changed.');
      }
      for (const file of snapshot) {
        this.files.set(file.path, file);
      }
      this.revision++;
      // The whole snapshot round-tripped, so it supersedes anything the
      // journal was still holding for an earlier write.
      this.onCommitted(snapshot, ++this.saveSequence);
      onCommit();
    });
    // A failed transaction must not poison future editor saves.
    this.pendingSave = operation.catch(() => {});
    await operation;
  }

  stat(path: string): VirtualWorkspaceFile {
    return { ...this.getFile(path) };
  }

  list(directory = '/'): VirtualWorkspaceFile[] {
    const normalizedDirectory = this.normalizePath(directory);
    const prefix = normalizedDirectory === '/' ? '/' : `${normalizedDirectory}/`;
    return [...this.files.values()]
      .filter((file) => file.path.startsWith(prefix))
      .sort((first, second) => first.path.localeCompare(second.path))
      .map((file) => ({ ...file }));
  }

  rename(sourcePath: string, destinationPath: string): void {
    const source = this.normalizePath(sourcePath);
    const destination = this.normalizePath(destinationPath);
    const file = this.getFile(source);
    if (this.files.has(destination)) {
      throw new Error(`File already exists: ${destination}`);
    }
    this.files.delete(source);
    this.files.set(destination, { ...file, path: destination });
    this.queueSave();
  }

  delete(path: string): void {
    const normalizedPath = this.normalizePath(path);
    if (!this.files.delete(normalizedPath)) {
      throw new Error(`File not found: ${normalizedPath}`);
    }
    this.queueSave();
  }

  async flush(): Promise<void> {
    await this.pendingSave;
  }

  async clear(): Promise<void> {
    this.revision++;
    this.files.clear();
    this.committed.clear();
    this.saveSequence++;
    this.journal.clear();
    this.pendingSave = this.pendingSave.then(() => this.store.clear());
    await this.pendingSave;
  }

  private getFile(path: string): VirtualWorkspaceFile {
    const normalizedPath = this.normalizePath(path);
    const file = this.files.get(normalizedPath);
    if (!file) {
      throw new Error(`File not found: ${normalizedPath}`);
    }
    return file;
  }

  private normalizePath(path: string): string {
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') {
        continue;
      }
      if (part === '..') {
        if (parts.length === 0) {
          throw new Error(`Path is outside the virtual workspace: ${path}`);
        }
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    return `/${parts.join('/')}`;
  }

  private queueSave(): void {
    this.revision++;
    const snapshot = this.list();
    // Recorded before the write is even queued: this is the only step that
    // has already happened once the edit returns to the caller.
    this.journal.record(this.pendingAgainstCommitted(snapshot));
    const sequence = ++this.saveSequence;
    this.pendingSave = this.pendingSave
      .then(() => this.store.save(snapshot))
      .then(() => this.onCommitted(snapshot, sequence));
  }

  /** What the store has not confirmed yet: files that differ from the
   * committed snapshot, and paths that are no longer present. */
  private pendingAgainstCommitted(snapshot: VirtualWorkspaceFile[]): VirtualWorkspaceJournalRecord {
    const paths = new Set(snapshot.map((file) => file.path));
    // Dated by the newest file either side knows about rather than by reading
    // the clock: it outranks every copy this session saw, and loses to a file
    // a later session writes over the deleted path.
    const at = Math.max(0, ...[...this.committed.values(), ...snapshot].map((file) => file.modifiedAt));
    return {
      files: snapshot.filter((file) => {
        const stored = this.committed.get(file.path);
        return !stored || stored.contents !== file.contents || stored.modifiedAt !== file.modifiedAt;
      }).map((file) => ({ ...file })),
      deleted: [...this.committed.keys()].filter((path) => !paths.has(path)).map((path) => ({ path, at })),
    };
  }

  private onCommitted(snapshot: VirtualWorkspaceFile[], sequence: number): void {
    this.committed = new Map(snapshot.map((file) => [file.path, { ...file }]));
    // A later edit has its own journal record; only the newest write may
    // declare the journal spent.
    if (sequence === this.saveSequence) {
      this.journal.clear();
    }
  }
}
