import * as vscode from "vscode";
import * as path from "path";
import { Logger } from "./services/Logger";

export class ShaderLocker {
  private isLocked = false;
  private lockedEditor: vscode.TextEditor | undefined = undefined;
  private currentlyPreviewedEditor: vscode.TextEditor | undefined = undefined;
  private logger!: Logger;

  constructor(
    private sendShaderCallback: (editor: vscode.TextEditor) => void,
  ) {
    this.logger = Logger.getInstance();
  }

  public getIsLocked(): boolean {
    return this.isLocked;
  }

  public getLockedEditor(): vscode.TextEditor | undefined {
    return this.lockedEditor;
  }

  public getCurrentlyPreviewedEditor(): vscode.TextEditor | undefined {
    return this.currentlyPreviewedEditor;
  }

  public setCurrentlyPreviewedEditor(editor: vscode.TextEditor): void {
    this.currentlyPreviewedEditor = editor;
  }

  public shouldUseLocked(editor: vscode.TextEditor): vscode.TextEditor {
    if (
      this.isLocked &&
      this.lockedEditor &&
      editor.document.uri.fsPath !== this.lockedEditor.document.uri.fsPath
    ) {
      return this.lockedEditor;
    }
    return editor;
  }

  public toggleLock(): void {
    this.isLocked = !this.isLocked;

    if (this.isLocked && this.currentlyPreviewedEditor) {
      this.lockedEditor = this.currentlyPreviewedEditor;
      this.sendShaderCallback(this.currentlyPreviewedEditor);
    } else {
      this.lockedEditor = undefined;
      this.findAndSwitchToRecentGlslFile();
    }
  }

  private findAndSwitchToRecentGlslFile(): void {
    // Find the most recently accessed GLSL file
    const glslTabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          return (
            uri.fsPath.endsWith(".glsl") ||
            vscode.workspace.textDocuments.find(
              (doc) =>
                doc.uri.fsPath === uri.fsPath && doc.languageId === "glsl",
            )
          );
        }
        return false;
      })
      .sort((a, b) => {
        if (a.isActive) {
          return -1;
        }
        if (b.isActive) {
          return 1;
        }
        return 0;
      });

    if (
      glslTabs.length > 0 && glslTabs[0].input instanceof vscode.TabInputText
    ) {
      const mostRecentGlslUri = glslTabs[0].input.uri;
      const mostRecentEditor = vscode.window.visibleTextEditors.find(
        (editor) => editor.document.uri.fsPath === mostRecentGlslUri.fsPath,
      );

      if (mostRecentEditor) {
        this.sendShaderCallback(mostRecentEditor);
      } else if (
        vscode.window.activeTextEditor?.document.languageId === "glsl"
      ) {
        this.sendShaderCallback(vscode.window.activeTextEditor);
      }
    } else if (vscode.window.activeTextEditor?.document.languageId === "glsl") {
      this.sendShaderCallback(vscode.window.activeTextEditor);
    }
  }
}
