import * as vscode from "vscode";
import * as fs from "fs";
import { GlslFileTracker } from "../GlslFileTracker";
import { Logger } from "../services/Logger";

export class NavigationHandler {
  constructor(
    private glslFileTracker: GlslFileTracker,
    private getPanelColumns: () => Set<vscode.ViewColumn>,
    private logger: Logger,
  ) {}

  async handleNavigateToBuffer(payload: { bufferPath: string; shaderPath: string }): Promise<void> {
    const enabled = vscode.workspace.getConfiguration('shader-studio').get('navigateOnBufferSwitch', true);
    if (!enabled) {
      return;
    }

    if (!payload.bufferPath || !fs.existsSync(payload.bufferPath)) {
      return;
    }

    const viewColumn = this.resolveTargetColumn(payload.shaderPath);
    const uri = vscode.Uri.file(payload.bufferPath);
    await vscode.window.showTextDocument(uri, { viewColumn, preview: false, preserveFocus: true });
  }

  async handleGoToLine(payload: { line: number; filePath: string }): Promise<void> {
    try {
      const { line, filePath } = payload;
      if (!filePath) {
        return;
      }

      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch (e) {
      this.logger.error(`Failed to go to line: ${e}`);
    }
  }

  resolveTargetColumn(shaderPath: string): vscode.ViewColumn {
    const panelColumns = this.getPanelColumns();
    const tabGroups = vscode.window.tabGroups.all;

    for (const group of tabGroups) {
      if (panelColumns.has(group.viewColumn)) {
        continue;
      }
      for (const tab of group.tabs) {
        if (tab.input && typeof tab.input === 'object' && 'uri' in tab.input) {
          const tabUri = (tab.input as { uri: vscode.Uri }).uri;
          if (tabUri.fsPath === shaderPath) {
            return group.viewColumn;
          }
        }
      }
    }

    for (const group of tabGroups) {
      if (!panelColumns.has(group.viewColumn)) {
        return group.viewColumn;
      }
    }

    return vscode.ViewColumn.One;
  }
}
