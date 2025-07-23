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

}
