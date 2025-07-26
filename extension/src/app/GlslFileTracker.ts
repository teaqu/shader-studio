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
        return editor.document.languageId === 'glsl' || editor.document.fileName.endsWith('.glsl');
    }
}
