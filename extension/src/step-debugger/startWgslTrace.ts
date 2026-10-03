import * as vscode from 'vscode';
import { createWgslTraceDebugConfiguration } from './WgslTraceConfiguration';

/** Start a DAP session from the existing preview's inspected pixel. */
export async function startWgslTrace(payload: unknown): Promise<void> {
  try {
    if (vscode.debug.activeDebugSession?.type === 'shader-studio-wgsl-trace') {
      throw new Error('Stop the current WGSL trace before starting another pixel recording.');
    }
    const configuration = createWgslTraceDebugConfiguration(payload);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(configuration.program));
    if (document.getText() !== configuration.source) {
      throw new Error('The preview shader differs from the current editor. Refresh the preview before tracing.');
    }
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
    const started = await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(document.uri), configuration);
    if (!started) {
      throw new Error('VS Code could not start the WGSL trace.');
    }
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}
