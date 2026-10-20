import type { ViewerRpcRequest, ViewerRpcResponse, ViewerSnapshot, ViewerCapture } from '@shader-studio/types';

export interface StandalonePreviewConnection {
  id: string;
  kind: 'webview' | 'browser';
  send(message: ViewerRpcRequest): void;
  sendSource?(message: unknown): Promise<void> | void;
}

interface PendingRequest {
  previewId: string;
  resolve(value: ViewerSnapshot | ViewerCapture): void;
  reject(error: Error): void;
  cleanup(): void;
}

/** Correlates replies with both request and connection; never broadcasts RPC. */
export class StandalonePreviews {
  private connections = new Map<string, StandalonePreviewConnection>();
  private pending = new Map<string, PendingRequest>();

  constructor(private readonly timeoutMs = 15000) {}

  register(connection: StandalonePreviewConnection): () => void {
    this.connections.set(connection.id, connection);
    return () => {
      this.connections.delete(connection.id);
      for (const [id, request] of this.pending) {
        if (request.previewId === connection.id) {
          this.finish(id, undefined, 'Preview disconnected. Open a Shader Studio preview and retry.');
        }
      }
    };
  }

  async sendSource(id: string, message: unknown): Promise<void> {
    const connection = this.connections.get(id);
    if (!connection?.sendSource) {
      throw new Error('Preview does not support targeted shader selection.');
    }
    await connection.sendSource(message);
  }

  list(): { id: string; kind: StandalonePreviewConnection['kind'] }[] {
    return [...this.connections.values()].map(({ id, kind }) => ({ id, kind }));
  }

  select(id?: string): string {
    if (id && this.connections.has(id)) {
      return id;
    }
    if (id) {
      throw new Error('Unknown previewId. Call list_previews again.');
    }
    if (this.connections.size === 1) {
      return this.connections.keys().next().value!;
    }
    throw new Error(this.connections.size ? 'Multiple previews are open. Specify previewId from list_previews.' : 'No preview is open. Open a Shader Studio panel or server preview.');
  }

  request(id: string, operation: ViewerRpcRequest['operation'], payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ViewerSnapshot | ViewerCapture> {
    const connection = this.connections.get(id);
    if (!connection) {
      return Promise.reject(new Error('Preview disconnected.'));
    }
    if (signal?.aborted) {
      return Promise.reject(new Error('Request cancelled.'));
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancelWithError = (error: string) => {
        try {
          connection.send({ type: 'viewerRpcRequest', requestId, operation: 'cancel', payload: {} });
        } catch {
          // The local promise must still settle if the viewer disconnected.
        }
        this.finish(requestId, undefined, error);
      };
      const cancel = () => cancelWithError('Request cancelled.');
      const timer = setTimeout(() => cancelWithError('Preview timed out. Ensure it is visible and responsive.'), this.timeoutMs);
      this.pending.set(requestId, { previewId: id, resolve, reject, cleanup: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      } });
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        connection.send({ type: 'viewerRpcRequest', requestId, operation, payload });
      } catch (error) {
        this.finish(requestId, undefined, String(error));
      }
    });
  }

  receive(previewId: string, message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const response = message as Partial<ViewerRpcResponse>;
    if (response.type !== 'viewerRpcResponse' || typeof response.requestId !== 'string') {
      return;
    }
    if (this.pending.get(response.requestId)?.previewId !== previewId) {
      return;
    }
    this.finish(response.requestId, response.result, response.error);
  }

  dispose(): void {
    for (const id of this.pending.keys()) {
      this.finish(id, undefined, 'Shader Studio closed.');
    }
    this.connections.clear();
  }

  private finish(id: string, result?: ViewerSnapshot | ViewerCapture, error?: string): void {
    const request = this.pending.get(id);
    if (!request) {
      return;
    }
    this.pending.delete(id);
    request.cleanup();
    if (error || !result) {
      request.reject(new Error(error || 'Invalid preview response.'));
    } else {
      request.resolve(result);
    }
  }
}
