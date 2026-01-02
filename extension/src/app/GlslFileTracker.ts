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
        return isGlslDocument(editor.document);
    }

    /**
     * Should we recommend a GLSL syntax highlighting extension?
     * Returns true if the file looks like a GLSL file by extension but the languageId is not set
     * and we haven't already detected an installed GLSL syntax extension.
     */
    public shouldRecommendGlslHighlighter(editor: vscode.TextEditor): boolean {
        const doc = editor?.document;
        if (!doc) return false;

        const looksLikeGlslByFile = doc.fileName.endsWith('.glsl') || doc.fileName.endsWith('.frag');
        const alreadyTagged = doc.languageId === 'glsl' || doc.languageId === 'frag';

        if (!looksLikeGlslByFile || alreadyTagged) {
            return false;
        }

        // Respect opt-out stored in global state
        if (this.context.globalState.get<boolean>('suppressGlslHighlightRecommendation')) {
            return false;
        }

        return true;
    }

    public async recommendGlslHighlighter(editor: vscode.TextEditor): Promise<void> {
        if (!this.shouldRecommendGlslHighlighter(editor)) return;

        const installLabel = 'Install "slevesque.shader"';
        const dontShowLabel = "Don't show again";

        const choice = await vscode.window.showInformationMessage(
            'No GLSL syntax highlighting detected. "Shader languages support for VS Code" is recommended extension for GLSL highlighting.',
            installLabel,
            dontShowLabel,
        );

        if (choice === installLabel) {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', 'slevesque.shader');
        } else if (choice === dontShowLabel) {
            await this.context.globalState.update('suppressGlslHighlightRecommendation', true);
        }
    }
}

export function isGlslDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'glsl' || document.languageId === 'frag'
        || document.fileName.endsWith('.glsl') || document.fileName.endsWith('.frag');
}
