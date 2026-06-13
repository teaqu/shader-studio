import * as vscode from "vscode";

export class GlslFileTracker {
  private lastViewedGlslFile: string | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.lastViewedGlslFile = this.context.globalState.get<string>('lastViewedGlslFile') || null;
  }

  public getActiveOrLastViewedGLSLEditor(): vscode.TextEditor | null {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isGlslEditor(activeEditor)) {
      this.setLastViewedGlslFile(activeEditor.document.uri.fsPath);
      return activeEditor;
    }

    if (this.lastViewedGlslFile) {
      const matchingEditor = vscode.window.visibleTextEditors.find(editor => {
        return editor.document.uri.fsPath === this.lastViewedGlslFile && this.isGlslEditor(editor);
      });
      if (matchingEditor) {
        return matchingEditor;
      }
    }

    return null;
  }

  public getLastViewedGlslFile(): string | null {
    return this.lastViewedGlslFile;
  }

  public setLastViewedGlslFile(filePath: string): void {
    this.lastViewedGlslFile = filePath;
    this.context.globalState.update('lastViewedGlslFile', filePath);
  }

  public isGlslEditor(editor: vscode.TextEditor): boolean {
    return isShaderDocument(editor.document);
  }

}

export function isGlslDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'glsl' || document.languageId === 'frag'
        || document.fileName.endsWith('.glsl') || document.fileName.endsWith('.frag');
}

export function isSlangDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'slang' || document.fileName.endsWith('.slang');
}

/** Any shader source we can preview (GLSL or Slang). */
export function isShaderDocument(document: vscode.TextDocument): boolean {
  return isGlslDocument(document) || isSlangDocument(document);
}

export function getShaderLanguage(filePath: string): 'glsl' | 'slang' {
  return filePath.endsWith('.slang') ? 'slang' : 'glsl';
}
