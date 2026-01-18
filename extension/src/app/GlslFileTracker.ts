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

    /**
     * Find an open editor for the given shader path across visible editors and all tab groups.
     * If the file is open in another tab group, this will reveal it (via showTextDocument)
     * and return the resulting TextEditor. Returns undefined if no open editor is found.
     */
    public async getMatchingEditorAllGroups(shaderPath: string): Promise<vscode.TextEditor | undefined> {
        // Check visible editors first
        const visibleMatch = vscode.window.visibleTextEditors.find(editor =>
            editor.document.uri.fsPath === shaderPath && this.isGlslEditor(editor)
        );
        if (visibleMatch) {
            return visibleMatch;
        }

        // Search all tab groups for the file
        for (const group of vscode.window.tabGroups.all) {
            const matchingTab = group.tabs.find(tab =>
                tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === shaderPath
            );
            if (matchingTab) {
                const uri = (matchingTab.input as vscode.TabInputText).uri;
                const document = await vscode.workspace.openTextDocument(uri);
                try {
                    return await vscode.window.showTextDocument(document, { viewColumn: group.viewColumn, preview: false });
                } catch {
                    // Fallback without viewColumn
                    return await vscode.window.showTextDocument(document, { preview: false });
                }
            }
        }

        return undefined;
    }
}

export function isGlslDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'glsl' || document.languageId === 'frag'
        || document.fileName.endsWith('.glsl') || document.fileName.endsWith('.frag');
}
