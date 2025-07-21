import * as vscode from "vscode";
import * as path from "path";

export interface ShaderInfo {
    type: string;
    code: string;
    name: string;
    config: any;
    isLocked: boolean;
    buffers: Record<string, string>;
}

export class ShaderUtils {

    public static getActiveGLSLEditor(): vscode.TextEditor | null {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && (activeEditor.document.languageId === 'glsl' ||
            activeEditor.document.fileName.endsWith('.glsl'))) {
            return activeEditor;
        }
        return null;
    }

    public static getCurrentShaderInfo(isLocked: boolean = false): ShaderInfo | null {
        const activeEditor = this.getActiveGLSLEditor();
        if (!activeEditor) {
            return null;
        }

        const shaderContent = activeEditor.document.getText();
        return {
            type: 'shaderSource',
            code: shaderContent,
            name: path.basename(activeEditor.document.fileName),
            config: null,
            isLocked,
            buffers: {}
        };
    }

    public static hasActiveGLSLFile(): boolean {
        return this.getActiveGLSLEditor() !== null;
    }
}
