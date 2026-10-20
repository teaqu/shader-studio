import type { Transport } from '../transport/MessageTransport';

/** Shared edit scheduling keeps both editors on the host's save/compile protocol. */
export class EditorSourceSession {
  private pending: { path: string; code: string } | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private compileTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly transport: Transport,
    private readonly compile: (code: string, path: string) => void,
    private readonly persisted: (code: string, path: string) => void,
  ) {}

  change(path: string, code: string, hot: boolean): void {
    if (!path) {
      return;
    }
    if (this.pending && this.pending.path !== path) {
      this.flush();
    }
    this.transport.markEditorDirty?.(path);
    clearTimeout(this.compileTimer);
    if (hot) {
      this.compileTimer = setTimeout(() => this.compile(code, path), 30);
    }
    this.pending = { path, code };
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flush(), 15);
  }

  flush(): void {
    clearTimeout(this.persistTimer);
    const source = this.pending;
    this.pending = null;
    if (source) {
      this.persisted(source.code, source.path);
      this.transport.postMessage({ type: 'updateShaderSource', payload: source });
    }
  }

  dispose(): void {
    this.flush();
    clearTimeout(this.compileTimer);
  }
}
