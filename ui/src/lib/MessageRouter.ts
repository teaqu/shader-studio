import type { ShaderStudio } from './ShaderStudio';

export interface MessageRouterCallbacks {
  onError: (errors: string[]) => void;
  onMessageError: (message: string) => void;
  onFileContents: (path: string, code: string) => void;
  onShaderSource: (event: MessageEvent) => void;
  onToggleEditorOverlay: () => void;
  onResetLayout: () => void;
  onManualCompile: () => void;
  onCompilationResult: (result: { success: boolean; errors?: string[] } | null) => void;
  onLockStateChanged: (isLocked: boolean) => void;
  onCustomUniformValues?: (values: { name: string; type: string; value: number | number[] | boolean }[]) => void;
}

export class MessageRouter {
  private pendingMessages: MessageEvent[] = [];
  private initialized = false;

  constructor(
    private getShaderStudio: () => ShaderStudio,
    private callbacks: MessageRouterCallbacks,
  ) {}

  markInitialized(): void {
    this.initialized = true;
  }

  bufferMessage(event: MessageEvent): void {
    this.pendingMessages.push(event);
  }

  replayPendingMessages(): void {
    for (const msg of this.pendingMessages) {
      this.handleMessage(msg);
    }
    this.pendingMessages = [];
  }

  async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      const { type } = event.data;

      if (type === 'error') {
        const payload = event.data.payload;
        this.callbacks.onError(Array.isArray(payload) ? payload : [payload]);
        return;
      }

      if (type === 'fileContents') {
        this.callbacks.onFileContents(
          event.data.payload.path || '',
          event.data.payload.code || '',
        );
        return;
      }

      if (type === 'customUniformValues') {
        this.callbacks.onCustomUniformValues?.(event.data.payload.values);
        return;
      }

      if (type === 'shaderSource') {
        this.callbacks.onShaderSource(event);
      }

      if (type === 'toggleEditorOverlay') {
        this.callbacks.onToggleEditorOverlay();
        return;
      }

      if (type === 'panelState') {
        return;
      }

      if (type === 'webServerState') {
        return;
      }

      if (type === 'resetLayout') {
        this.callbacks.onResetLayout();
        return;
      }

      if (type === 'manualCompile') {
        this.callbacks.onManualCompile();
        return;
      }

      const shaderStudio = this.getShaderStudio();
      const result = await shaderStudio.handleShaderMessage(event);

      if (result) {
        this.callbacks.onCompilationResult(result);
      }

      this.callbacks.onLockStateChanged(shaderStudio.getIsLocked());
    } catch (err) {
      const errorMsg = `Shader message handling failed: ${err}`;
      console.error('ShaderStudio: Error in handleShaderMessage:', err);
      console.error('ShaderStudio: Error stack:', err instanceof Error ? err.stack : 'No stack');
      console.error('ShaderStudio: Event data:', event.data);
      this.callbacks.onMessageError(errorMsg);
    }
  }
}
