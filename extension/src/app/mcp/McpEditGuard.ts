import * as path from 'node:path';

interface GuardedEdit {
  text: string;
  previewPath: string;
  timeout: ReturnType<typeof setTimeout>;
  allowInitialEmpty: boolean;
  observedExpectedText: boolean;
}

/** Correlates an MCP WorkspaceEdit with the single hot-reload event it causes. */
export class McpEditGuard {
  private edits = new Map<string, GuardedEdit>();

  constructor(private readonly timeoutMs = 1000, private readonly platform = process.platform) {}

  private key(editedPath: string): string {
    return this.platform === 'win32' ? path.win32.normalize(editedPath).toLowerCase() : path.normalize(editedPath);
  }

  arm(editedPath: string, text: string, previewPath: string): void {
    const key = this.key(editedPath);
    this.clear(editedPath);
    const timeout = setTimeout(() => this.clear(key), this.timeoutMs);
    this.edits.set(key, {
      text, previewPath, timeout, allowInitialEmpty: false, observedExpectedText: true,
    });
  }

  /**
   * A create-and-insert WorkspaceEdit can report an empty document before its
   * requested contents. Suppress only that known transition and duplicate
   * metadata events, never arbitrary intervening text.
   */
  armSuppression(editedPath: string, expectedText: string, durationMs = 500): void {
    const key = this.key(editedPath);
    this.clear(key);
    const timeout = setTimeout(() => this.clear(key), durationMs);
    this.edits.set(key, {
      text: expectedText, previewPath: '', timeout, allowInitialEmpty: true, observedExpectedText: false,
    });
  }

  take(editedPath: string, text: string): string | undefined {
    const key = this.key(editedPath);
    const edit = this.edits.get(key);
    if (!edit) {
      return undefined;
    }
    if (text === edit.text) {
      edit.observedExpectedText = true;
      return edit.previewPath;
    }
    if (edit.allowInitialEmpty && !edit.observedExpectedText && text === '') {
      return edit.previewPath;
    }
    this.clear(key);
    return undefined;
  }

  clear(editedPath: string): void {
    const key = this.key(editedPath);
    const edit = this.edits.get(key);
    if (edit) {
      clearTimeout(edit.timeout);
      this.edits.delete(key);
    }
  }
}

export const mcpEditGuard = new McpEditGuard();
