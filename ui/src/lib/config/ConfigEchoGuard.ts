import type { ShaderConfig } from '@shader-studio/types';

/** Tracks local edits while their asynchronous host acknowledgement is in flight. */
export class ConfigEchoGuard {
  private path = '';
  private sequence: number | undefined;
  private pending: string | undefined;
  private readonly obsolete = new Set<string>();

  recordLocalEdit(path: string, before: ShaderConfig | null, after: ShaderConfig): void {
    this.selectPath(path);
    const previous = configKey(before);
    const next = configKey(after);
    if (previous === next) {
      return;
    }
    this.obsolete.add(previous);
    this.obsolete.delete(next);
    this.pending = next;
  }

  accepts(path: string, config: ShaderConfig | null, sequence?: number): boolean {
    this.selectPath(path);
    if (sequence !== undefined && this.sequence !== undefined && sequence < this.sequence) {
      return false;
    }
    if (sequence !== undefined) {
      this.sequence = sequence;
    }
    const key = configKey(config);
    if (this.pending !== undefined && key !== this.pending && this.obsolete.has(key)) {
      return false;
    }
    // The latest local edit has been acknowledged, or a distinct external edit
    // is authoritative. Known earlier edits stop blocking future manual changes.
    this.pending = undefined;
    this.obsolete.clear();
    return true;
  }

  private selectPath(path: string): void {
    if (path === this.path) {
      return;
    }
    this.path = path;
    this.sequence = undefined;
    this.pending = undefined;
    this.obsolete.clear();
  }
}

function configKey(config: ShaderConfig | null): string {
  // Host path resolution adds display-independent URIs to the echoed config.
  return JSON.stringify(config, (key, value) => key === 'resolved_path' ? undefined : value);
}
