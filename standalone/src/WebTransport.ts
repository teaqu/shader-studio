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
  MemoryWorkspaceStore,
  VirtualWorkspace,
} from './VirtualWorkspace';
import { WebExtensionHost } from './WebExtensionHost';

function createWorkspace() {
  const seeds = createDefaultWorkspaceFiles();
  if (typeof indexedDB === 'undefined') {
    return VirtualWorkspace.open(new MemoryWorkspaceStore(), seeds);
  }
  return VirtualWorkspace.open(new IndexedDbWorkspaceStore(), seeds)
    .catch(() => VirtualWorkspace.open(new MemoryWorkspaceStore(), seeds));
}

export class WebTransport implements Transport {
  private connected = true;
  private started = false;
  private readonly host = createWorkspace().then((workspace) => new WebExtensionHost(workspace, {
    resolveDefaultAsset: resolveDefaultAssetUrl,
  }));
  private readonly viewerCleanups = new Set<() => void>();

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
    if (!this.connected) {
      return;
    }
    void this.host.then(async (host) => {
      if (!this.connected) {
        return;
      }
      this.viewerCleanups.add(host.onViewerMessage((message) => {
        if (message.type === 'showNewShaderModal') {
          setNewShaderVisible(true);
          return;
        }
        handler(new MessageEvent('message', { data: message }));
      }));
      if (!this.started) {
        this.started = true;
        await host.start();
      }
    });
  }

  async readEditorFile(path: string): Promise<string | null> {
    return (await this.host).readEditorFile(path);
  }

  getShaderExplorerHostApi(): ShaderExplorerHostApi {
    return {
      postMessage: (message) => {
        if (this.connected) {
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
              handler(new MessageEvent('message', { data: message }));
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
  }

  async clearWorkspace(): Promise<void> {
    const host = await this.host;
    await host.clearWorkspace();
    clearEditorDocuments();
  }

  getType(): 'web' {
    return 'web';
  }

  isConnected(): boolean {
    return this.connected;
  }
}
