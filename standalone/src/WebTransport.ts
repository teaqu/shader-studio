import { clearEditorDocuments, setEditorDocument } from './state/editorDocuments.svelte';
import { selectEditor, requestEditor, requestPanel, setNewShaderVisible } from './state/shellState.svelte';
import type { BaseMessage } from '@shader-studio/types';
import type {
  ShaderExplorerHostApi,
  Transport,
  TransportMessage,
} from '@shader-studio/ui';
import { createDefaultWorkspaceFiles, resolveDefaultAssetUrl } from './defaultWorkspace';
import {
  IndexedDbWorkspaceStore,
  LocalStorageWorkspaceJournal,
  MemoryWorkspaceStore,
  VirtualWorkspace,
  type WorkspaceImportOptions,
  type WorkspacePersistenceStatus,
} from './VirtualWorkspace';
import { WebExtensionHost } from './WebExtensionHost';

const EXPLORER_STATE_KEY = 'shader-studio-explorer-state';

export interface WorkspaceStorageStatus {
  /** IndexedDB survives a session; the memory fallback does not. */
  backend: 'indexeddb' | 'session';
  /** Browser eviction protection, if the Storage API can report it. */
  persisted: boolean | null;
  persistSupported: boolean;
}

interface WorkspaceSession {
  workspace: VirtualWorkspace;
  backend: WorkspaceStorageStatus['backend'];
}

type StorageManagerLike = Pick<StorageManager, 'persist' | 'persisted'>;

/** Missing or denied browser storage APIs become a status result, not an
 * exception that can interrupt editing. */
export async function inspectWorkspaceStorage(
  backend: WorkspaceStorageStatus['backend'],
  storage: StorageManagerLike | undefined = navigator.storage,
  requestPersistence = false,
): Promise<WorkspaceStorageStatus> {
  const persistSupported = typeof storage?.persist === 'function';
  if (backend === 'session') {
    return { backend, persisted: false, persistSupported };
  }
  if (requestPersistence && persistSupported) {
    try {
      await storage.persist();
    } catch {
      // Query below is the authoritative outcome after a denied request.
    }
  }
  if (typeof storage?.persisted !== 'function') {
    return { backend, persisted: null, persistSupported };
  }
  try {
    return { backend, persisted: await storage.persisted(), persistSupported };
  } catch {
    return { backend, persisted: null, persistSupported };
  }
}

function savedExplorerState(fallback: unknown): unknown {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(EXPLORER_STATE_KEY) ?? 'null');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function createWorkspace(): Promise<WorkspaceSession> {
  const seeds = createDefaultWorkspaceFiles();
  if (typeof indexedDB === 'undefined') {
    return VirtualWorkspace.open(new MemoryWorkspaceStore(), seeds)
      .then(workspace => ({ workspace, backend: 'session' as const }));
  }
  // Edits are journalled synchronously: a reload during a queued database
  // write must not take the text back to the last committed snapshot.
  const journal = new LocalStorageWorkspaceJournal();
  return VirtualWorkspace.open(new IndexedDbWorkspaceStore(), seeds, undefined, journal)
    .then(workspace => ({ workspace, backend: 'indexeddb' as const }))
    .catch(() => VirtualWorkspace.open(new MemoryWorkspaceStore(), seeds, undefined, journal)
      .then(workspace => ({ workspace, backend: 'session' as const })));
}

export class WebTransport implements Transport {
  private connected = true;
  private started = false;
  private readonly session = createWorkspace();
  private readonly workspace = this.session.then(({ workspace }) => workspace);
  private readonly host = this.workspace.then((workspace) => new WebExtensionHost(workspace, {
    resolveDefaultAsset: resolveDefaultAssetUrl,
  }));
  private readonly viewerCleanups = new Set<() => void>();
  private readonly persistenceCleanups = new Set<() => void>();

  postMessage<const TMessage extends BaseMessage>(message: TransportMessage<TMessage>): void {
    if (this.connected) {
      if (message.type === 'extensionCommand' && 'payload' in message
        && (message.payload as { command?: string } | undefined)?.command === 'openShaderExplorer') {
        requestPanel('explorer');
        return;
      }
      void this.host.then(async (host) => {
        if (!this.connected) {
          return;
        }
        if (message.type === 'navigateToBuffer') {
          const payload = 'payload' in message ? message.payload as { bufferPath?: unknown } | null : null;
          const path = payload?.bufferPath;
          if (typeof path === 'string') {
            const code = host.readEditorFile(path);
            if (code !== null) {
              setEditorDocument(path, code);
              requestEditor(path);
            }
          }
          return;
        }
        await host.handleViewerMessage(message as { type: string; [key: string]: unknown });
        if (message.type === 'updateShaderSource' && 'payload' in message) {
          const payload = message.payload as { path?: string };
          if (payload.path) {
            setEditorDocument(payload.path, host.readEditorFile(payload.path));
          }
        }
      });
    }
  }

  onMessage(handler: (event: MessageEvent) => void): void {
    this.subscribeViewer(handler);
  }

  /** Each viewer owns its listeners, while the shell owns the workspace. */
  createViewerTransport(): Transport {
    let disposed = false;
    const cleanups = new Set<() => void>();
    return {
      postMessage: message => {
        if (!disposed) {
          this.postMessage(message);
        }
      },
      onMessage: handler => {
        if (!disposed) {
          cleanups.add(this.subscribeViewer(handler));
        }
      },
      dispose: () => {
        disposed = true;
        for (const cleanup of cleanups) {
          cleanup();
        }
        cleanups.clear();
      },
      getType: () => this.getType(),
      isConnected: () => !disposed && this.isConnected(),
      getWorkspaceDocuments: language => this.getWorkspaceDocuments(language),
      applyWorkspaceEdit: (changes, isCurrent, commit, openTexts) =>
        this.applyWorkspaceEdit(changes, () => !disposed && isCurrent(), commit, openTexts),
    };
  }

  private subscribeViewer(handler: (event: MessageEvent) => void): () => void {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const unsubscribe = () => {
      disposed = true;
      cleanup?.();
      this.viewerCleanups.delete(unsubscribe);
    };
    if (!this.connected) {
      return unsubscribe;
    }
    this.viewerCleanups.add(unsubscribe);
    void this.host.then(async (host) => {
      if (!this.connected || disposed) {
        return;
      }
      cleanup = host.onViewerMessage((message) => {
        if (message.type === 'showNewShaderModal') {
          setNewShaderVisible(true);
          return;
        }
        if (message.type === 'openEditorFile') {
          const path = (message.payload as { path?: unknown } | undefined)?.path;
          if (typeof path === 'string') {
            setEditorDocument(path, host.readEditorFile(path));
            requestEditor(path);
          }
          return;
        }
        handler(new MessageEvent('message', { data: message }));
      });
      if (!this.started) {
        this.started = true;
        await host.start();
      }
    });
    return unsubscribe;
  }

  async getWorkspaceDocuments(language: import('@shader-studio/types').ShaderLanguageId) {
    return (await this.host).getWorkspaceDocuments(language);
  }

  async applyWorkspaceEdit(
    changes: readonly { uri: string; before: string; after: string }[],
    isCurrent: () => boolean,
    commit: () => void,
    openTexts?: ReadonlyMap<string, string>,
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('Editor disconnected. No files were changed.');
    }
    await (await this.host).applyWorkspaceEdit(changes, () => this.connected && isCurrent(), () => {
      commit();
      for (const change of changes) {
        setEditorDocument(decodeURIComponent(new URL(change.uri).pathname), change.after);
      }
    }, openTexts);
  }

  async readEditorFile(path: string): Promise<string | null> {
    return (await this.host).readEditorFile(path);
  }

  getShaderExplorerHostApi(): ShaderExplorerHostApi {
    return {
      postMessage: (message) => {
        if (this.connected) {
          if (message.type === 'saveState') {
            // Preferences must be durable when the control changes, even if
            // thumbnail/workspace writes are queued when the page unloads.
            try {
              localStorage.setItem(EXPLORER_STATE_KEY, JSON.stringify(message.state ?? null));
            } catch {
              // Restricted/quota-limited storage retains the workspace fallback.
            }
          }
          void this.host.then(async (host) => {
            await host.handleExplorerMessage(message);
            if (typeof message.path === 'string') {
              setEditorDocument(message.path, host.readEditorFile(message.path));
            }
            if (this.connected && message.type === 'openShader' && typeof message.path === 'string'
              && host.readEditorFile(message.path) !== null) {
              selectEditor(message.path);
            }
          });
        }
      },
      onMessage: (handler) => {
        let cleanup: (() => void) | undefined;
        let disposed = false;
        void this.host.then((host) => {
          if (!disposed && this.connected) {
            cleanup = host.onExplorerMessage((message) => {
              handler(new MessageEvent('message', { data: message.type === 'shadersUpdate'
                ? { ...message, savedState: savedExplorerState(message.savedState) } : message }));
            });
          }
        });
        return () => {
          disposed = true;
          cleanup?.();
        };
      },
    };
  }

  dispose(): void {
    this.connected = false;
    for (const cleanup of this.viewerCleanups) {
      cleanup();
    }
    this.viewerCleanups.clear();
    for (const cleanup of this.persistenceCleanups) {
      cleanup();
    }
    this.persistenceCleanups.clear();
  }

  async clearWorkspace(): Promise<void> {
    const host = await this.host;
    await host.clearWorkspace();
    clearEditorDocuments();
  }

  /** Wait until every queued workspace write has either committed or failed. */
  async flush(): Promise<void> {
    await (await this.workspace).flush();
  }

  /** A portable snapshot for user-initiated download; it includes pending edits. */
  async exportWorkspaceBackup(): Promise<string> {
    return (await this.workspace).exportBackup();
  }

  /** Import requires `{ replace: true }` whenever there are existing files. */
  async importWorkspaceBackup(backup: unknown, options?: WorkspaceImportOptions): Promise<void> {
    await (await this.workspace).importBackup(backup, options);
  }

  async getPersistenceStatus(): Promise<WorkspacePersistenceStatus> {
    return (await this.workspace).persistenceStatus;
  }

  /** Reports whether saves have an IndexedDB backend and, where supported,
   * whether the browser has granted eviction protection. Never throws merely
   * because a privacy mode omits the Storage API. */
  async getStorageStatus(): Promise<WorkspaceStorageStatus> {
    const { backend } = await this.session;
    return inspectWorkspaceStorage(backend);
  }

  /** Best effort only: a browser may refuse durable quota without this being an
   * application error. The returned status is the authoritative result. */
  async requestPersistentStorage(): Promise<WorkspaceStorageStatus> {
    const { backend } = await this.session;
    return inspectWorkspaceStorage(backend, undefined, true);
  }

  onPersistenceStatus(listener: (status: WorkspacePersistenceStatus) => void): () => void {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const cleanup = () => {
      disposed = true;
      unsubscribe?.();
      this.persistenceCleanups.delete(cleanup);
    };
    this.persistenceCleanups.add(cleanup);
    void this.workspace.then((workspace) => {
      if (!disposed) {
        unsubscribe = workspace.onPersistenceStatus(status => {
          if (this.connected && !disposed) {
            listener(status);
          }
        });
      }
    });
    return cleanup;
  }

  getType(): 'web' {
    return 'web';
  }

  isConnected(): boolean {
    return this.connected;
  }
}
