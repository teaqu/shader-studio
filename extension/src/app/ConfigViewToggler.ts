import * as vscode from 'vscode';
import { Logger } from './services/Logger';
import { Constants } from './Constants';

/**
 * Handles toggling between source (text) and preview (custom) editors for shader config files.
 * Provides markdown-style toggle behavior that never creates duplicate tabs.
 */
export class ConfigViewToggler {
  constructor(private readonly logger: Logger) {}

  /**
   * Toggles between source and preview view for the current shader config file.
   * Behavior:
   * - If currently in custom editor -> switch to text editor
   * - If currently in text editor -> switch to custom editor
   * - Reuses existing tabs when possible, never creates duplicates
   */
  async toggle(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    const currentTab = vscode.window.tabGroups.activeTabGroup.activeTab;

    const editorInfo = this.getCurrentEditorInfo(currentTab, activeEditor);
    
    if (!editorInfo.documentUri) {
      this.logger.warn("No shader config file found to toggle");
      return;
    }

    try {
      if (editorInfo.isInCustomEditor) {
        await this.switchToTextEditor(editorInfo.documentUri);
      } else {
        await this.switchToCustomEditor(editorInfo.documentUri);
      }
    } catch (error) {
      this.logger.error(`Failed to toggle config view: ${error}`);
      vscode.window.showErrorMessage(`Failed to toggle view: ${error}`);
    }
  }

  private getCurrentEditorInfo(
    currentTab: vscode.Tab | undefined,
    activeEditor: vscode.TextEditor | undefined
  ): { documentUri: vscode.Uri | undefined; isInCustomEditor: boolean } {
    let documentUri: vscode.Uri | undefined;
    let isInCustomEditor = false;

    if (currentTab?.input instanceof vscode.TabInputCustom &&
        (currentTab.input as vscode.TabInputCustom).viewType === Constants.CONFIG_EDITOR_VIEW_TYPE) {
      documentUri = (currentTab.input as vscode.TabInputCustom).uri;
      isInCustomEditor = true;
    } else if (activeEditor && activeEditor.document.fileName?.endsWith(Constants.CONFIG_FILE_EXTENSION)) {
      documentUri = activeEditor.document.uri;
    }

    return { documentUri, isInCustomEditor };
  }

  private async switchToTextEditor(documentUri: vscode.Uri): Promise<void> {
    const targetTab = this.findTextEditorTab(documentUri);
    
    if (targetTab) {
      const tabGroup = vscode.window.tabGroups.all.find(group => group.tabs.includes(targetTab));
      if (tabGroup) {
        // First make sure the tab group is active, then the specific tab
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        await vscode.window.showTextDocument(documentUri, { 
          viewColumn: tabGroup.viewColumn,
          preserveFocus: false 
        });
      }
    } else {
      await vscode.window.showTextDocument(documentUri, { viewColumn: vscode.ViewColumn.Beside });
    }
  }

  private async switchToCustomEditor(documentUri: vscode.Uri): Promise<void> {
    const targetTab = this.findCustomEditorTab(documentUri);
    
    if (targetTab) {
      const tabGroup = vscode.window.tabGroups.all.find(group => group.tabs.includes(targetTab));
      if (tabGroup) {
        await vscode.commands.executeCommand("vscode.openWith", documentUri, Constants.CONFIG_EDITOR_VIEW_TYPE, tabGroup.viewColumn);
      }
    } else {
      await vscode.commands.executeCommand("vscode.openWith", documentUri, Constants.CONFIG_EDITOR_VIEW_TYPE, vscode.ViewColumn.Beside);
    }
  }

  private findTextEditorTab(documentUri: vscode.Uri): vscode.Tab | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText &&
            (tab.input as vscode.TabInputText).uri.toString() === documentUri.toString()) {
          return tab;
        }
      }
    }
    return undefined;
  }

  private findCustomEditorTab(documentUri: vscode.Uri): vscode.Tab | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputCustom &&
            (tab.input as vscode.TabInputCustom).viewType === Constants.CONFIG_EDITOR_VIEW_TYPE &&
            (tab.input as vscode.TabInputCustom).uri.toString() === documentUri.toString()) {
          return tab;
        }
      }
    }
    return undefined;
  }
}
