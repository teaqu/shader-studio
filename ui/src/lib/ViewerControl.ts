import type { ViewerRpcRequest, ViewerRpcResponse, ViewerSnapshot, ViewerCapture } from '@shader-studio/types';

export interface ViewerControlHost {
  snapshot(): ViewerSnapshot;
  capture(): Promise<ViewerCapture>;
  readStorage(payload: Record<string, unknown>): Promise<NonNullable<ViewerSnapshot['storageRead']>>;
  settings(payload: Record<string, unknown>): void;
  playback(payload: Record<string, unknown>): Promise<void> | void;
  respond(message: ViewerRpcResponse): void;
}

/** The viewer knows renderer state; neither transport nor MCP needs to. */
export class ViewerControl {
  private pendingCompiles = new Set<string>();
  private completed = new Map<string, number>();
  private disposed = false;
  private commandQueue: Promise<void> = Promise.resolve();
  private requests = new Map<string, { cancelled: boolean; started: number }>();

  constructor(private readonly host: ViewerControlHost, private readonly timeoutMs = 12000) {}

  compileStarted(path: string, sequence: number | undefined): void {
    this.pendingCompiles.add(`${path}:${sequence}`);
  }

  compileFinished(path: string, sequence: number | undefined): void {
    this.pendingCompiles.delete(`${path}:${sequence}`);
    if (sequence !== undefined) {
      this.completed.set(path, Math.max(sequence, this.completed.get(path) ?? 0));
    }
  }

  get compiling(): boolean {
    return this.pendingCompiles.size > 0;
  }

  compileCancelled(path: string, sequence: number | undefined): void {
    this.pendingCompiles.delete(`${path}:${sequence}`);
  }

  dispose(): void {
    this.disposed = true;
  }

  handle(message: ViewerRpcRequest): void {
    if (message.operation === 'cancel') {
      const request = this.requests.get(message.requestId);
      if (request) {
        request.cancelled = true;
      }
      return;
    }
    const request = { cancelled: false, started: Date.now() };
    this.requests.set(message.requestId, request);
    // Mutations and captures cannot overlap, but source messages must remain
    // free to complete while a request waits for its required compile.
    this.commandQueue = this.commandQueue.then(async () => {
      try {
        await this.waitUntilReady(message.payload, request);
        switch (message.operation) {
          case 'settings': this.host.settings(message.payload); break;
          case 'playback': await this.host.playback(message.payload); break;
          case 'get_state': case 'capture': case 'read_storage': break;
          default: throw new Error('Unsupported viewer operation.');
        }
        const result = message.operation === 'capture' ? await this.host.capture() : this.host.snapshot();
        if (message.operation === 'read_storage') {
          result.storageRead = await this.host.readStorage(message.payload);
        }
        this.host.respond({ type: 'viewerRpcResponse', requestId: message.requestId, result });
      } catch (error) {
        this.host.respond({ type: 'viewerRpcResponse', requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
      } finally {
        this.requests.delete(message.requestId);
      }
    });
  }

  private async waitUntilReady(payload: Record<string, unknown>, request: { cancelled: boolean; started: number }): Promise<void> {
    while (!this.disposed) {
      if (request.cancelled) {
        throw new Error('Request cancelled.');
      }
      if (Date.now() - request.started >= this.timeoutMs) {
        throw new Error('Timed out waiting for the requested shader to compile.');
      }
      const state = this.host.snapshot();
      if (typeof payload.expectedPath === 'string' && state.path !== payload.expectedPath) {
        throw new Error('Preview switched shaders. Read the shader again before continuing.');
      }
      const requiredPath = payload.requiredPath;
      const requiredSequence = payload.requiredSequence;
      const sequenceReady = typeof requiredPath !== 'string' || typeof requiredSequence !== 'number'
        || (this.completed.get(requiredPath) ?? -1) >= requiredSequence;
      if (!this.compiling && sequenceReady) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Viewer closed.');
  }
}

export function validateViewerSettings(payload: Record<string, unknown>): void {
  const allowed = new Set(['fpsLimit', 'speed', 'uniforms', 'expectedPath']);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw new Error(`Unsupported viewer setting: ${key}`);
    }
  }
  if (payload.fpsLimit !== undefined && (typeof payload.fpsLimit !== 'number' || !Number.isFinite(payload.fpsLimit) || payload.fpsLimit < 0 || payload.fpsLimit > 1000)) {
    throw new Error('fpsLimit must be between 0 and 1000 (0 means unlimited).');
  }
  if (payload.speed !== undefined && (typeof payload.speed !== 'number' || !Number.isFinite(payload.speed) || payload.speed < 0 || payload.speed > 100)) {
    throw new Error('speed must be between 0 and 100.');
  }
}
