import * as vscode from 'vscode';

export class ShaderStudioStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private isServerRunning: boolean = false;

    constructor(private context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.updateServerStatus(false);
        this.statusBarItem.command = 'shader-studio.showShaderStudioMenu';
        this.statusBarItem.show();
        this.context.subscriptions.push(this.statusBarItem);
    }

    public updateServerStatus(isRunning: boolean, _port?: number) {
        this.isServerRunning = isRunning;
        this.statusBarItem.text = "SHA";
        this.statusBarItem.tooltip = "Shader Studio - Click to open panel";
    }

    public async showShaderStudioMenu() {
        await vscode.commands.executeCommand('shader-studio.view');
    }

    public dispose() {
        this.statusBarItem.dispose();
    }
}
