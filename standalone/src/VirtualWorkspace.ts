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

function cloneFiles(files: VirtualWorkspaceFile[]): VirtualWorkspaceFile[] {
  return files.map((file) => ({ ...file }));
}

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
  private pendingSave: Promise<void> = Promise.resolve();

  private constructor(
    private readonly store: VirtualWorkspaceStore,
    files: VirtualWorkspaceFile[],
    private readonly now: () => number,
  ) {
    for (const file of files) {
      const path = this.normalizePath(file.path);
      this.files.set(path, { ...file, path });
    }
  }

  static async open(
    store: VirtualWorkspaceStore,
    seedFiles: VirtualWorkspaceFile[],
    now: () => number = () => Date.now(),
  ): Promise<VirtualWorkspace> {
    const storedFiles = await store.load();
    const workspace = new VirtualWorkspace(store, storedFiles ?? seedFiles, now);
    if (storedFiles === null) {
      workspace.queueSave();
      await workspace.flush();
    }
    return workspace;
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
    this.files.clear();
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
    const snapshot = this.list();
    this.pendingSave = this.pendingSave.then(() => this.store.save(snapshot));
  }
}
