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
import { installSlangAssetMetadata } from '@shader-studio/ui/lib/slangAssets';

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

  constructor() {
    installSlangAssetMetadata();
  }

  postMessage<const TMessage extends BaseMessage>(message: TransportMessage<TMessage>): void {
    if (this.connected) {
      void this.host.then((host) => host.handleViewerMessage(message as { type: string; [key: string]: unknown }));
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
        handler(new MessageEvent('message', { data: message }));
      }));
      if (!this.started) {
        this.started = true;
        await host.start();
      }
    });
  }

  getShaderExplorerHostApi(): ShaderExplorerHostApi {
    return {
      postMessage: (message) => {
        if (this.connected) {
          void this.host.then((host) => host.handleExplorerMessage(message));
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
  }

  getType(): 'web' {
    return 'web';
  }

  isConnected(): boolean {
    return this.connected;
  }
}
