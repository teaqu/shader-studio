import * as vscode from 'vscode';
import type { WgslTraceLaunch, WgslTraceRecording, WgslTraceUniform, WgslTraceFrameUniforms } from '@shader-studio/types';
import { validateWgslTraceLaunch } from '@shader-studio/types';

/** A dedicated runner panel; intentionally has no Messenger/ShaderStudio dependency. */
export class WgslTraceHost {
  private panel?: vscode.WebviewPanel;
  private pendingReject?: (error: Error) => void;
  private document?: vscode.TextDocument;
  private version?: number;
  private source?: string;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  sourceIsCurrent(): boolean {
    return !!this.document && this.document.version === this.version && this.document.getText() === this.source;
  }

  async capture(configuration: Record<string, unknown>): Promise<WgslTraceRecording> {
    if (this.disposed) {
      throw new Error('Trace session was cancelled.');
    }
    if (typeof configuration.program !== 'string') {
      throw new Error('Set program to the path of a single WGSL shader.');
    }
    this.document = await vscode.workspace.openTextDocument(vscode.Uri.file(configuration.program));
    if (this.disposed) {
      throw new Error('Trace session was cancelled.');
    }
    this.version = this.document.version;
    this.source = this.document.getText();
    if (configuration.source !== undefined && configuration.source !== this.source) {
      throw new Error('The preview shader differs from the current editor. Refresh the preview before tracing.');
    }
    const launch: WgslTraceLaunch = { source: this.source, path: this.document.uri.fsPath,
      width: (configuration.width ?? 256) as number, height: (configuration.height ?? 256) as number,
      pixel: (configuration.pixel ?? [128, 128]) as [number, number], time: (configuration.time ?? 0) as number,
      frame: (configuration.frame ?? 0) as number, capacity: (configuration.capacity ?? 4096) as number,
      customUniforms: configuration.customUniforms as WgslTraceUniform[] | undefined,
      uniforms: configuration.uniforms as WgslTraceFrameUniforms | undefined };
    validateWgslTraceLaunch(launch);
    const panel = vscode.window.createWebviewPanel('shader-studio.wgslTrace', 'WGSL Step Trace (PoC)',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] });
    this.panel = panel;
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'wgsl-trace.js'));
    const nonce = globalThis.crypto.randomUUID().replace(/-/g, '');
    return new Promise<WgslTraceRecording>((resolve, reject) => {
      this.pendingReject = reject;
      let finished = false;
      const timeout = setTimeout(() => finish(undefined, new Error('WGSL trace capture timed out after 30 seconds.')), 30000);
      const finish = (recording?: WgslTraceRecording, error?: Error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeout);
        messages.dispose();
        closed.dispose();
        this.pendingReject = undefined;
        if (error) {
          reject(error);
        } else {
          resolve(recording!);
        }
      };
      const messages = panel.webview.onDidReceiveMessage((message: { type: string; recording?: WgslTraceRecording; message?: string }) => {
        if (message.type === 'wgslTraceReady') {
          void panel.webview.postMessage({ type: 'captureWgslTrace', launch });
        } else if (message.type === 'wgslTraceResult' && message.recording) {
          finish(message.recording);
        } else if (message.type === 'wgslTraceError') {
          finish(undefined, new Error(message.message ?? 'WGSL trace capture failed.'));
        }
      });
      const closed = panel.onDidDispose(() => finish(undefined, new Error('WGSL trace runner was closed.')));
      panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';">
</head><body><h2>WGSL step debugger proof of concept</h2>
<p id="status">Starting the GPU runner…</p>
<p>Single-file mainImage tracing with explicit launch inputs. Trace values are recorded on the GPU. Stepping highlights the original shader editor.</p>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
    });
  }

  onClose(callback: () => void): vscode.Disposable {
    return this.panel!.onDidDispose(callback);
  }

  dispose(): void {
    this.disposed = true;
    this.pendingReject?.(new Error('WGSL trace capture cancelled.'));
    this.pendingReject = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }
}
