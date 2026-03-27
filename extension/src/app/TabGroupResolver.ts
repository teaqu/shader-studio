import * as vscode from "vscode";

const EXTENSION_PREFIX = "shader-studio";

export interface TabGroupInfo {
    viewColumn: vscode.ViewColumn;
    tabs: ReadonlyArray<{ label: string; input: unknown }>;
}

export class TabGroupResolver {
  private lastActiveEditorColumn: vscode.ViewColumn | undefined;
  private disposable: vscode.Disposable;

  constructor() {
    this.disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.viewColumn) {
        this.lastActiveEditorColumn = editor.viewColumn;
      }
    });
  }

  public dispose(): void {
    this.disposable.dispose();
  }

  /**
     * Find the best tab group to open a file in, avoiding any group
     * that contains a Shader Studio extension panel.
     */
  public findTargetColumn(): vscode.ViewColumn {
    const groups = vscode.window.tabGroups.all as readonly TabGroupInfo[];
    return this.resolveColumn(groups, this.lastActiveEditorColumn);
  }

  public findColumnForExtensionTab(
    viewTypes: readonly string[],
    labels: readonly string[],
    fallback: vscode.ViewColumn,
  ): vscode.ViewColumn {
    const groups = vscode.window.tabGroups.all as readonly TabGroupInfo[];
    return this.resolveExtensionTabColumn(groups, viewTypes, labels, fallback);
  }

  /**
     * Pure logic extracted for testability.
     */
  public resolveColumn(
    groups: readonly TabGroupInfo[],
    lastActiveEditorColumn: vscode.ViewColumn | undefined,
  ): vscode.ViewColumn {
    const eligible = groups.filter((g) => !TabGroupResolver.groupHasExtensionPanel(g));

    if (eligible.length === 0) {
      return vscode.ViewColumn.Beside;
    }

    // Prefer the last active eligible group
    if (lastActiveEditorColumn !== undefined) {
      const match = eligible.find((g) => g.viewColumn === lastActiveEditorColumn);
      if (match) {
        return match.viewColumn;
      }
    }

    return eligible[0].viewColumn;
  }

  public resolveExtensionTabColumn(
    groups: readonly TabGroupInfo[],
    viewTypes: readonly string[],
    labels: readonly string[],
    fallback: vscode.ViewColumn,
  ): vscode.ViewColumn {
    const match = groups.find((group) =>
      group.tabs.some((tab) => {
        const tabViewType = (tab.input as any)?.viewType;
        return (
          (typeof tabViewType === "string" && viewTypes.includes(tabViewType)) ||
                    labels.includes(tab.label)
        );
      }),
    );

    return match?.viewColumn ?? fallback;
  }

  /**
     * Check whether a tab group contains any Shader Studio extension panel.
     * Checks both viewType (for webview panels) and label (as fallback).
     */
  public static groupHasExtensionPanel(group: TabGroupInfo): boolean {
    return group.tabs.some((tab) => TabGroupResolver.isExtensionTab(tab));
  }

  public static isExtensionTab(tab: { label: string; input: unknown }): boolean {
    // Check viewType on the input (works for TabInputWebview and TabInputCustom)
    const viewType = (tab.input as any)?.viewType;
    if (typeof viewType === 'string' && viewType.startsWith(EXTENSION_PREFIX)) {
      return true;
    }

    // Fallback: check by known panel labels
    const extensionLabels = ["Shader Studio", "Shader Explorer", "Snippet Library"];
    if (extensionLabels.includes(tab.label)) {
      return true;
    }

    return false;
  }
}
